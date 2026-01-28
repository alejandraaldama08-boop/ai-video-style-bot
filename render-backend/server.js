import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import https from "https";
import http from "http";

const app = express();
app.use(express.json({ limit: "50mb" }));

// -----------------------------
// CORS (MUY IMPORTANTE)
// -----------------------------
const corsOptions = {
  origin: (origin, cb) => {
    // Permite llamadas sin origin (health checks, curl, etc.)
    if (!origin) return cb(null, true);

    const isVercel = /^https:\/\/.*\.vercel\.app$/.test(origin);
    const isLocalhost = /^http:\/\/localhost:\d+$/.test(origin);
    const isRender = /^https:\/\/.*\.onrender\.com$/.test(origin);

    if (isVercel || isLocalhost || isRender) return cb(null, true);

    return cb(new Error("Not allowed by CORS: " + origin), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // <-- preflight global

// -----------------------------
// Paths / storage
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, "uploads");
// Render puede ser read-only en algunas rutas; si falla, usa /tmp
function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
    return p;
  } catch (e) {
    return null;
  }
}
let finalUploadDir = ensureDir(UPLOAD_DIR);
if (!finalUploadDir) {
  finalUploadDir = ensureDir(path.join(os.tmpdir(), "uploads"));
}
if (!finalUploadDir) {
  throw new Error("No se pudo crear carpeta de uploads.");
}

// Servir archivos subidos como públicos
app.use("/uploads", express.static(finalUploadDir, { maxAge: "1h" }));

// -----------------------------
// Multer
// -----------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, finalUploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

// límite 200MB por archivo (ajústalo si quieres)
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

// -----------------------------
// Helpers
// -----------------------------
function getBaseUrl(req) {
  // En Render detrás de proxy, usa x-forwarded-proto/host
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function execFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      resolve({ stdout, stderr });
    });
  });
}

function execFFprobe(args) {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

function downloadToFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;

    const req = client.get(url, (res) => {
      // Redirecciones
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadToFile(res.headers.location, outPath));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed ${res.statusCode} for ${url}`));
      }

      const fileStream = fs.createWriteStream(outPath);
      res.pipe(fileStream);
      fileStream.on("finish", () => fileStream.close(() => resolve(outPath)));
      fileStream.on("error", reject);
    });

    req.on("error", reject);
  });
}

async function isUrlPublicHttp(url) {
  return typeof url === "string" && /^https?:\/\/.+/i.test(url);
}

// -----------------------------
// Routes
// -----------------------------
app.get("/health", async (_req, res) => {
  try {
    const { stdout } = await execFFprobe(["-version"]);
    res.json({ ok: true, service: "render-backend", ffprobe: stdout.split("\n")[0] });
  } catch (e) {
    res.json({ ok: true, service: "render-backend", ffprobe: "not found", warning: String(e?.message || e) });
  }
});

// Subida: form-data con campo "file"
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file received" });

    const base = getBaseUrl(req);
    const publicUrl = `${base}/uploads/${req.file.filename}`;

    res.json({
      ok: true,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      url: publicUrl,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Upload failed", details: String(e?.message || e) });
  }
});

/**
 * Render:
 * body: {
 *   clips: [{ url: "https://....mp4" }, ...],
 *   platform?: "tiktok"|"reels"|"youtube",
 *   duration?: number
 * }
 */
app.post("/generate", async (req, res) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clipforge-"));
  try {
    const { clips } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "Expected body.clips[]" });
    }

    // validar urls
    for (const c of clips) {
      if (!c?.url || !(await isUrlPublicHttp(c.url))) {
        return res.status(400).json({
          ok: false,
          error: "Each clip must have a public http(s) url",
          got: c?.url,
        });
      }
    }

    // Descargar clips a /tmp
    const downloaded = [];
    for (let i = 0; i < clips.length; i++) {
      const url = clips[i].url;
      const out = path.join(tmpRoot, `clip-${i}.mp4`);
      await downloadToFile(url, out);
      downloaded.push(out);
    }

    // Crear concat list
    const listPath = path.join(tmpRoot, "list.txt");
    const listContent = downloaded.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    fs.writeFileSync(listPath, listContent);

    // Output
    const outName = `render-${Date.now()}.mp4`;
    const outPath = path.join(finalUploadDir, outName);

    // Concatenar sin reencode si se puede; si falla, reencode
    try {
      await execFFmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outPath,
      ]);
    } catch (_copyErr) {
      // fallback reencode
      await execFFmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outPath,
      ]);
    }

    const base = getBaseUrl(req);
    const publicUrl = `${base}/uploads/${outName}`;

    return res.json({
      ok: true,
      url: publicUrl,
      filename: outName,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "FFmpeg failed",
      details: String(e?.message || e),
    });
  } finally {
    // limpiar tmp
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
});

// -----------------------------
// Start
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
