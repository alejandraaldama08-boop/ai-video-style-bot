import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import multer from "multer";

const app = express();
app.use(cors());

// JSON solo para endpoints que lo usan
app.use(express.json({ limit: "50mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
app.use("/out", express.static(OUT_DIR));

// Multer: guarda archivos subidos en /out
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, OUT_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".mp4") || ".mp4";
    cb(null, `upload-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

/**
 * POST /upload
 * form-data:
 * - file: (video)
 * devuelve: { ok:true, url:"https://.../out/upload-xxx.mp4" }
 */
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded (field name must be 'file')" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/out/${req.file.filename}`;
    res.json({ ok: true, url, filename: req.file.filename });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Upload failed", details: String(e?.message || e) });
  }
});

/**
 * POST /render
 * body: { clips:[{url:"https://.../out/upload-xxx.mp4"}], format:"reels"|"tiktok"|"youtube" }
 */
app.post("/render", async (req, res) => {
  try {
    const clipUrl = req.body?.clips?.[0]?.url;

    if (!clipUrl) {
      return res.status(400).json({ ok: false, error: "Missing clips[0].url" });
    }
    if (String(clipUrl).startsWith("blob:")) {
      return res.status(400).json({
        ok: false,
        error: "Got blob: URL. You must upload first to /upload and pass the returned http(s) URL into /render.",
        got: clipUrl,
      });
    }

    const id = Date.now();
    const inputPath = path.join(OUT_DIR, `input-${id}.mp4`);
    const outputPath = path.join(OUT_DIR, `render-${id}.mp4`);

    // Descarga la URL http(s) a local (por si es externa)
    const r = await fetch(clipUrl);
    if (!r.ok) throw new Error(`Download failed ${r.status}: ${r.statusText}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(inputPath, buf);

    // Render vertical 1080x1920
    const cmd =
      `ffmpeg -y -i "${inputPath}" ` +
      `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" ` +
      `-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart ` +
      `"${outputPath}"`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({
          ok: false,
          error: "FFmpeg failed",
          details: String(stderr || stdout || err.message).slice(0, 2000),
        });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      res.json({
        ok: true,
        url: `${baseUrl}/out/render-${id}.mp4`,
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Render crashed", details: String(e?.message || e).slice(0, 2000) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));
