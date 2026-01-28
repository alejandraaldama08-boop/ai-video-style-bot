import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const app = express();

// ---------- Config básica ----------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------- CORS (IMPORTANTE) ----------
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",

  // Lovable preview / lovable.app / lovableproject.com
  "https://lovable.dev",
  "https://beta.lovable.dev",
  "https://lovable.app",
  "https://lovableproject.com",

  // Tu Vercel (añade tu dominio aquí si cambió)
  "https://ai-video-style-bot-jom9-r0wd3z85j.vercel.app",
  "https://ai-video-style-bot-jom9.vercel.app",
];

const corsOptions = {
  origin: (origin, cb) => {
    // Permite requests sin origin (curl / server-to-server)
    if (!origin) return cb(null, true);

    // Permitir cualquier subdominio de lovable.app / lovableproject.com / vercel.app
    const isLovable =
      origin.endsWith(".lovable.app") ||
      origin.endsWith(".lovableproject.com") ||
      origin.endsWith(".vercel.app");

    if (allowedOrigins.includes(origin) || isLovable) return cb(null, true);

    return cb(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

app.use(cors(corsOptions));
// Responder preflight SIEMPRE
app.options("*", cors(corsOptions));

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- Static ----------
app.use("/uploads", express.static(UPLOADS_DIR));

// ---------- Multer ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 500 }, // 500MB
});

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

// ---------- Upload endpoint ----------
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const publicUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({
      ok: true,
      filename: req.file.filename,
      originalname: req.file.originalname,
      url: publicUrl,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- Render endpoint (placeholder) ----------
/**
 * OJO: aquí debes tener tu lógica real de render con ffmpeg/remotion.
 * Si ya la tienes en tu proyecto, pega tu lógica dentro de este handler.
 */
app.post("/render", async (req, res) => {
  try {
    // Devuelve error claro si no llega payload
    if (!req.body) return res.status(400).json({ ok: false, error: "Missing body" });

    // ✅ Si ya tienes tu render real, reemplaza desde aquí
    // Esto es solo para confirmar que el endpoint existe y no da 404.
    return res.json({ ok: true, received: req.body });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- 404 friendly ----------
app.use((_req, res) => {
  res.status(404).send("Not Found");
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
