import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const app = express();
app.set("trust proxy", 1); // importante en Render para URLs correctas

// --- Paths (ESM compatible) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Ensure uploads folder exists ---
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- CORS (permitir Lovable + Vercel + localhost) ---
const allowedOriginRegex = [
  /^https:\/\/.*\.lovable\.app$/,
  /^https:\/\/.*\.lovable\.dev$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
];

app.use(
  cors({
    origin: (origin, cb) => {
      // origin undefined pasa cuando llamas desde server-to-server o curl
      if (!origin) return cb(null, true);

      const ok = allowedOriginRegex.some((re) => re.test(origin));
      if (ok) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Responder preflight SIEMPRE
app.options("*", cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Serve uploads as static files ---
app.use("/uploads", express.static(UPLOAD_DIR));

// --- Multer setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

// --- Health check ---
app.get("/health", async (req, res) => {
  execFile("ffmpeg", ["-version"], (err, stdout) => {
    if (err) return res.status(200).json({ ok: true, ffmpeg: false });
    const firstLine = (stdout || "").split("\n")[0];
    res.status(200).json({ ok: true, ffmpeg: firstLine });
  });
});

// --- Upload endpoint (POST) ---
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const publicUrl = `${baseUrl}/uploads/${encodeURIComponent(req.file.filename)}`;

    return res.status(200).json({
      ok: true,
      url: publicUrl,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// (Opcional) test simple para ver que el server responde
app.get("/", (req, res) => res.send("render-backend online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
