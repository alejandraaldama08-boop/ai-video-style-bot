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

// ---------- CORS ----------
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://lovable.dev",
  "https://beta.lovable.dev",
  "https://lovable.app",
  "https://lovableproject.com",
  "https://ai-video-style-bot-jom9-r0wd3z85j.vercel.app",
  "https://ai-video-style-bot-jom9.vercel.app",
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

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
app.options("*", cors(corsOptions));

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "uploads");
const RENDERS_DIR = path.join(__dirname, "renders");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(RENDERS_DIR)) fs.mkdirSync(RENDERS_DIR, { recursive: true });

// ---------- Static ----------
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/renders", express.static(RENDERS_DIR));

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

// ---------- Helpers ----------
function getPublicBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function pickDimensions(format) {
  // Ajusta si quieres otros tamaños
  if (format === "tiktok" || format === "reels") return { w: 1080, h: 1920 };
  if (format === "youtube") return { w: 1920, h: 1080 };
  return { w: 1080, h: 1920 };
}

function localPathFromUploadsUrl(url) {
  // Espera urls tipo https://host/uploads/filename.mp4
  const u = new URL(url);
  const filename = path.basename(u.pathname);
  return path.join(UPLOADS_DIR, filename);
}

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

// ---------- Upload ----------
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const publicUrl = `${getPublicBaseUrl(req)}/uploads/${req.file.filename}`;
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

// ---------- Render (FFmpeg) ----------
app.post("/render", async (req, res) => {
  try {
    const payload = req.body || {};
    const clips = Array.isArray(payload.clips) ? payload.clips : [];
    const format = (payload.format || "reels").toLowerCase();
    const duration = Number(payload.duration || 0);

    if (!clips.length || !clips[0]?.url) {
      return res.status(400).json({ ok: false, error: "Missing clips[0].url" });
    }

    const inputUrl = clips[0].url;
    const inputPath = localPathFromUploadsUrl(inputUrl);

    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({
        ok: false,
        error: "Input file not found on server",
        details: { inputUrl, inputPath },
      });
    }

    const { w, h } = pickDimensions(format);

    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // Escala y encaja con pad para que sea vertical/horizontal según formato
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    const args = [
      "-y",
      "-i", inputPath,
      ...(duration > 0 ? ["-t", String(duration)] : []),
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an", // quita audio para evitar problemas
      outPath,
    ];

    execFile("ffmpeg", args, { timeout: 1000 * 60 * 8 }, (err, _stdout, stderr) => {
      if (err) {
        return res.status(500).json({
          ok: false,
          error: "FFmpeg failed",
          details: stderr?.slice?.(0, 4000) || String(err),
        });
      }

      const videoUrl = `${getPublicBaseUrl(req)}/renders/${outName}`;
      return res.json({
        ok: true,
        url: videoUrl,
        videoUrl, // por compatibilidad con front
        format,
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- 404 ----------
app.use((_req, res) => res.status(404).send("Not Found"));

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
