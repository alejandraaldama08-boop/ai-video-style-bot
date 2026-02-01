import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS abierto (ajustaremos luego si quieres)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

app.use(express.json({ limit: "100mb" }));

// =======================
// Carpetas
// =======================
const UPLOADS_DIR = path.join(__dirname, "uploads");
const RENDERS_DIR = path.join(__dirname, "renders");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });

app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/renders", express.static(RENDERS_DIR));

// =======================
// Upload (clips + música)
// =======================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

// ✅ sin fileFilter restrictivo: acepta mp3/m4a/wav/video etc
const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB, ajusta si quieres
});

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file" });

  const url = `${req.protocol}://${req.get("host")}/uploads/${encodeURIComponent(file.filename)}`;

  res.json({
    ok: true,
    url,
    name: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  });
});

// =======================
// Health
// =======================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: true });
});

// =======================
// Plan (simple) — para que no falle el chat si llama /plan
// =======================
app.post("/plan", (req, res) => {
  const { context } = req.body || {};
  // Plan muy básico (luego lo haremos “bueno”)
  res.json({
    success: true,
    plan: {
      style: { name: "dynamic", transitions: true, zoom: false, beatSync: false },
      duration: context?.duration ?? 30,
      format: context?.format ?? "reels",
      overlays: [],
      suggestions: ["Sube música para mejor ritmo"],
    },
  });
});

// =======================
// JOBS en memoria
// =======================
const jobs = new Map(); // jobId -> { status, outputUrl, error, details }

// GET /job/:id
app.get("/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ status: "error", error: "Job not found" });
  res.json(job);
});

// =======================
// Render MP4 (JOB async)
// =======================
app.post("/render", async (req, res) => {
  const jobId = crypto.randomBytes(8).toString("hex");

  try {
    const { clips = [], music, format = "reels", duration } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    // Creamos el job YA y devolvemos jobId
    jobs.set(jobId, { status: "processing" });
    res.json({ jobId });

    const isVertical = format !== "youtube";
    const W = isVertical ? 1080 : 1920;
    const H = isVertical ? 1920 : 1080;

    const toLocal = (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
      return path.join(UPLOADS_DIR, name);
    };

    const inputs = clips
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((c) => toLocal(c.url));

    inputs.forEach((p) => {
      if (!fs.existsSync(p)) throw new Error(`Missing clip on server: ${p}`);
    });

    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // filtros: scale+pad cada clip + concat
    const filter = [];
    for (let i = 0; i < inputs.length; i++) {
      filter.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      );
    }
    filter.push(inputs.map((_, i) => `[v${i}]`).join("") + `concat=n=${inputs.length}:v=1:a=0[vout]`);

    const args = ["-y"];
    inputs.forEach((p) => args.push("-i", p));

    let hasMusic = false;
    if (music?.url) {
      const m = toLocal(music.url);
      if (fs.existsSync(m)) {
        args.push("-i", m);
        hasMusic = true;
      }
    }

    args.push("-filter_complex", filter.join(";"));
    args.push("-map", "[vout]");

    if (hasMusic) {
      // último input es el audio
      args.push("-map", `${inputs.length}:a`, "-shortest", "-c:a", "aac");
    } else {
      args.push("-an");
    }

    if (duration) args.push("-t", String(duration));

    args.push(
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
      outPath
    );

    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (err) {
        jobs.set(jobId, {
          status: "error",
          error: "FFmpeg error",
          details: String(stderr || "").slice(0, 3000),
        });
        return;
      }

      const outputUrl = `${req.protocol}://${req.get("host")}/renders/${encodeURIComponent(outName)}`;
      jobs.set(jobId, { status: "done", outputUrl });
    });
  } catch (e) {
    jobs.set(jobId, { status: "error", error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
