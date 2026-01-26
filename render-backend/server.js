import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "node:child_process";

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" })); // videos grandes

// ---- Paths / folders ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Servir archivos generados
app.use("/out", express.static(OUT_DIR, { fallthrough: true }));

// ---- Helpers ----
function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function runFFmpeg(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").slice(-4000);
    const err = new Error("FFmpeg failed");
    err.details = msg;
    throw err;
  }
  return r;
}

async function downloadToFile(url, destPath) {
  // Node 18+ tiene fetch global (Render suele usar Node 18/20)
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);

  const fileStream = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

// ---- Basic endpoints ----
app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.get("/health", (req, res) => {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
    if (r.status !== 0) {
      return res.status(500).json({ ok: false, error: "ffmpeg not available" });
    }
    const firstLine = (r.stdout || "").split("\n")[0];
    res.json({ ok: true, ffmpeg: firstLine });
  } catch (e) {
    res.status(500).json({ ok: false, error: "ffmpeg not available" });
  }
});

// ---- Upload endpoint (para evitar blob:) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, OUT_DIR),
  filename: (req, file, cb) => {
    const id = uid();
    const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
    cb(null, `upload-${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }
    const url = `${baseUrl(req)}/out/${req.file.filename}`;
    res.json({
      ok: true,
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Upload failed", details: String(e?.message || e) });
  }
});

// ---- Render endpoint ----
// Espera: { clips: [{url}], format: "tiktok"|"reels"|"youtube" , duration?: number }
app.post("/render", async (req, res) => {
  try {
    const { clips = [], format = "reels" } = req.body || {};

    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    // Validar URLs (Lovable NO puede mandar blob:)
    for (const c of clips) {
      if (!c?.url || typeof c.url !== "string") {
        return res.status(400).json({ ok: false, error: "Clip missing url" });
      }
      if (c.url.startsWith("blob:")) {
        return res.status(400).json({
          ok: false,
          error: "Lovable is sending a blob: URL (local browser URL). Backend cannot access it. You must upload the file and send a public http(s) URL.",
          got: c.url,
        });
      }
      if (!c.url.startsWith("http://") && !c.url.startsWith("https://")) {
        return res.status(400).json({ ok: false, error: "Clip url must be http(s)", got: c.url });
      }
    }

    const jobId = uid();
    const workDir = path.join(OUT_DIR, `job-${jobId}`);
    fs.mkdirSync(workDir, { recursive: true });

    // Dimensiones por formato
    const isVertical = format === "tiktok" || format === "reels";
    const targetW = isVertical ? 1080 : 1920;
    const targetH = isVertical ? 1920 : 1080;

    // 1) Descargar clips
    const downloaded = [];
    for (let i = 0; i < clips.length; i++) {
      const srcUrl = clips[i].url;
      const dest = path.join(workDir, `in-${i}.mp4`);
      await downloadToFile(srcUrl, dest);
      downloaded.push(dest);
    }

    // 2) Normalizar cada clip (misma resolución/codec)
    const normalized = [];
    for (let i = 0; i < downloaded.length; i++) {
      const inFile = downloaded[i];
      const outFile = path.join(workDir, `norm-${i}.mp4`);

      // scale + pad para mantener aspect ratio
      const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`;

      runFFmpeg([
        "-y",
        "-i",
        inFile,
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
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        outFile,
      ]);

      normalized.push(outFile);
    }

    // 3) Concatenar (si 1 clip, usar ese)
    const finalName = `render-${jobId}.mp4`;
    const finalPath = path.join(OUT_DIR, finalName);

    if (normalized.length === 1) {
      // asegurar faststart
      runFFmpeg([
        "-y",
        "-i",
        normalized[0],
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        finalPath,
      ]);
    } else {
      // concat demuxer
      const listPath = path.join(workDir, "concat.txt");
      fs.writeFileSync(
        listPath,
        normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf8"
      );

      // Intento rápido (copy)
      try {
        runFFmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          finalPath,
        ]);
      } catch (e) {
        // Fallback re-encode
        runFFmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          finalPath,
        ]);
      }
    }

    const url = `${baseUrl(req)}/out/${finalName}`;
    const downloadUrl = `${baseUrl(req)}/download/${jobId}`;

    res.json({
      ok: true,
      jobId,
      status: "done",
      progress: 100,
      url,
      downloadUrl,
      message: "Render completado ✅",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: "FFmpeg failed",
      details: String(e?.details || e?.message || e),
    });
  }
});

// Link “bonito” de descarga
app.get("/download/:jobId", (req, res) => {
  const file = `render-${req.params.jobId}.mp4`;
  const filePath = path.join(OUT_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  return res.redirect(302, `/out/${file}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));
