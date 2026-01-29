import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ Render usa proxy; esto ayuda a que req.protocol sea https cuando toca
app.set("trust proxy", 1);

app.use(cors());
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

// ✅ helper para construir URLs correctas (https en Render)
function baseUrl(req) {
  const proto = req.header("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

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

// ✅ Permitir vídeo + audio (mp3, wav, m4a, etc.)
const allowedMimes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "audio/mpeg", // mp3
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4", // m4a
  "audio/aac",
  "audio/ogg",
]);

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    // si el browser no envía mimetype bien, permitimos por extensión como fallback
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const allowedExt = new Set([".mp4", ".mov", ".webm", ".mkv", ".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

    if (allowedMimes.has(file.mimetype) || allowedExt.has(ext)) return cb(null, true);
    return cb(new Error(`Tipo de archivo no permitido: ${file.mimetype} (${file.originalname})`), false);
  },
});

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  const url = `${baseUrl(req)}/uploads/${encodeURIComponent(file.filename)}`;
  res.json({ ok: true, url, name: file.originalname });
});

// =======================
// Health
// =======================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: true });
});

// =======================
// PLAN (para el chat) ✅
// =======================
app.post("/plan", async (req, res) => {
  // De momento: plan “útil” mock para no romper el chat.
  // Luego conectamos aquí IA real (OpenAI) y usamos clips/music/ref/youtube.
  const { context } = req.body || {};
  const format = context?.format || "reels";
  const duration = context?.duration || 30;

  res.json({
    plan: {
      style: { name: "dynamic", transitions: true, zoom: false, beatSync: false },
      format,
      duration,
      overlays: [],
      suggestions: [
        "Si tienes música, activa beatSync para cortes al ritmo",
        "Usa un hook potente en los primeros 2 segundos",
      ],
      timeline: [],
    },
  });
});

// =======================
// Jobs (para polling) ✅
// =======================
// Guardamos jobs en memoria (suficiente por ahora)
const JOBS = new Map(); // jobId -> { status, outputUrl?, error?, createdAt }

function makeJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

app.get("/job/:id", (req, res) => {
  const job = JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ status: "not_found", error: "Job not found" });
  res.json(job);
});

// =======================
// Render MP4 REAL
// =======================
app.post("/render", async (req, res) => {
  let jobId = null;

  try {
    const { clips = [], music, format = "reels", duration } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    // ✅ Crea job y responde con jobId (tu frontend hace polling)
    jobId = makeJobId();
    JOBS.set(jobId, { status: "processing", createdAt: Date.now() });
    res.json({ ok: true, jobId });

    const isVertical = format !== "youtube";
    const W = isVertical ? 1080 : 1920;
    const H = isVertical ? 1920 : 1080;

    // Resolver rutas locales
    const toLocal = (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
      return path.join(UPLOADS_DIR, name);
    };

    const inputs = clips.map((c) => toLocal(c.url));
    inputs.forEach((p) => {
      if (!fs.existsSync(p)) throw new Error("Missing clip on server: " + p);
    });

    const outName = `${Date.now()}-final.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // Construir filtros
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
      args.push("-map", `${inputs.length}:a`, "-shortest", "-c:a", "aac");
    } else {
      args.push("-an");
    }

    if (duration) args.push("-t", String(duration));

    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath);

    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (err) {
        JOBS.set(jobId, {
          status: "error",
          error: "FFmpeg error",
          details: stderr?.slice?.(0, 3000),
          createdAt: Date.now(),
        });
        return;
      }

      const url = `${baseUrl(req)}/renders/${encodeURIComponent(outName)}`;

      // ✅ Guardamos estado del job para polling
      JOBS.set(jobId, { status: "done", outputUrl: url, url, createdAt: Date.now() });
    });
  } catch (e) {
    if (jobId) JOBS.set(jobId, { status: "error", error: String(e), createdAt: Date.now() });
    // si ya respondimos con jobId, no devolvemos otro res aquí
    // si no respondimos, entonces sí:
    // (pero en este flujo ya respondimos antes)
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
