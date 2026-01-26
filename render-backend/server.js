import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ====== Config ======
const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || "/tmp";
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, "out");

// crea carpetas
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// CORS + JSON
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// sirve outputs
app.use("/out", express.static(OUT_DIR));

// ====== Multer upload ======
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 800 * 1024 * 1024 }, // 800MB
});

// ====== Helpers ======
function nowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeName(name = "file") {
  return name.replace(/[^\w.\-]+/g, "_");
}

async function getFfmpegVersion() {
  return await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", () => resolve(out.split("\n")[0] || "ffmpeg"));
    p.on("error", () => resolve("ffmpeg (not found)"));
  });
}

async function downloadToFile(url, destPath) {
  // Node 18+ tiene fetch global
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  // Convertir WebStream a Node stream
  const nodeStream =
    res.body && typeof res.body.getReader === "function"
      ? Readable.fromWeb(res.body)
      : res.body; // por si ya fuese Node stream

  if (!nodeStream) throw new Error("No response body to download");

  await pipeline(nodeStream, fs.createWriteStream(destPath));
  return destPath;
}

async function runFfmpeg(args) {
  return await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (code === 0) return resolve({ ok: true });
      return reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });

    p.on("error", (err) => reject(err));
  });
}

// ====== Routes ======
app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.get("/health", async (req, res) => {
  const ffmpeg = await getFfmpegVersion();
  res.json({ ok: true, service: "render-backend", ffmpeg });
});

// Solo para que no te salga "Cannot GET /upload" en navegador
app.get("/upload", (req, res) => {
  res.json({
    ok: true,
    message: "Upload endpoint ready ✅. Use POST /upload (multipart/form-data, field: file)",
  });
});

// POST /upload => devuelve URL pública /out/...
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const original = safeName(req.file.originalname || "upload.mp4");
    const outName = `upload-${nowId()}-${original}`;
    const outPath = path.join(OUT_DIR, outName);

    fs.renameSync(req.file.path, outPath);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res.json({
      ok: true,
      url: `${baseUrl}/out/${outName}`,
      name: req.file.originalname,
      size: req.file.size,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Upload failed", details: String(e?.message || e) });
  }
});

/**
 * POST /render
 * Body esperado (mínimo):
 * {
 *   "clips": [{ "url": "https://....mp4" }],
 *   "format": "reels" | "tiktok" | "youtube",
 *   "duration": 10 | 15 | 30 | 60
 * }
 */
app.post("/render", async (req, res) => {
  try {
    const body = req.body || {};
    const clips = Array.isArray(body.clips) ? body.clips : [];

    if (!clips[0] || !clips[0].url) {
      return res.status(400).json({
        ok: false,
        error: 'The one of all properties "expected body.clips[0].url"',
      });
    }

    const clipUrl = clips[0].url;

    // validar que sea http/https (no blob:)
    if (!/^https?:\/\//i.test(clipUrl)) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid clip url. Must be a public http(s) URL. (No blob: / local browser URLs)",
        got: clipUrl,
      });
    }

    const format = (body.format || "reels").toLowerCase();
    const duration = Number(body.duration || 10);

    // tamaños según formato
    let targetW = 1080, targetH = 1920; // reels/tiktok
    if (format === "youtube") {
      targetW = 1920;
      targetH = 1080;
    }

    // paths temporales
    const inPath = path.join(TMP_DIR, `in-${nowId()}.mp4`);
    const outName = `render-${nowId()}.mp4`;
    const outPath = path.join(OUT_DIR, outName);

    // descargar clip
    await downloadToFile(clipUrl, inPath);

    // ffmpeg args: escala y recorta a tamaño target, limita duración y genera mp4
    // -vf: scale + crop centrado (cover)
    const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`;

    const args = [
      "-y",
      "-i",
      inPath,
      "-t",
      String(duration),
      "-vf",
      vf,
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
    ];

    await runFfmpeg(args);

    // limpiar input temporal
    try { fs.unlinkSync(inPath); } catch {}

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res.json({
      ok: true,
      status: "done",
      downloadUrl: `${baseUrl}/out/${outName}`,
      file: outName,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "FFmpeg failed",
      details: String(e?.message || e),
    });
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
