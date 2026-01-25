import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carpeta donde guardamos videos temporales
const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Servir archivos generados
app.use("/out", express.static(OUT_DIR));

// Jobs en memoria (simple, para demo)
const jobs = new Map(); // jobId -> { status, downloadUrl, fileName, progress, error }

// Encuentra una fuente típica en Linux (Render suele tener DejaVu)
function findFontFile() {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.get("/health", (req, res) => {
  try {
    const out = execSync("ffmpeg -version", { stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .split("\n")[0];
    res.json({ ok: true, ffmpeg: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: "ffmpeg not available" });
  }
});

/**
 * FRONTEND expects:
 * POST /generate -> { jobId, status, progress, downloadUrl }
 * GET  /status/:jobId -> RenderJob
 * GET  /download/:jobId -> redirect al mp4 real
 */
app.post("/generate", (req, res) => {
  try {
    // Aceptamos prompt o text (para que no te falle)
    const prompt = req.body?.prompt ?? req.body?.text ?? "Hola";
    const secondsRaw = req.body?.seconds ?? 3;
    const safeSeconds = Math.max(1, Math.min(Number(secondsRaw) || 3, 15));

    // Generamos job
    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const fileName = `demo-${jobId}.mp4`;
    const output = path.join(OUT_DIR, fileName);

    // Sanitizar texto para ffmpeg drawtext
    const text = String(prompt)
      .slice(0, 120)
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'")
      .replace(/\n/g, " ");

    const fontFile = findFontFile();

    // Si hay fuente: vídeo con texto centrado
    // Si NO hay fuente: vídeo negro (fallback)
    const drawTextFilter = fontFile
      ? `drawtext=fontfile='${fontFile}':text='${text}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`
      : null;

    const cmd = drawTextFilter
      ? `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${safeSeconds} -vf "${drawTextFilter}" -c:v libx264 -pix_fmt yuv420p "${output}"`
      : `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${safeSeconds} -c:v libx264 -pix_fmt yuv420p "${output}"`;

    // Ejecutar
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const downloadUrl = `${baseUrl}/out/${fileName}`;

    const job = {
      jobId,
      status: "done",
      progress: 100,
      downloadUrl,
    };

    jobs.set(jobId, { ...job, fileName });

    // Respuesta estilo RenderJob
    return res.json(job);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      jobId: "error",
      status: "error",
      error: String(e?.message || e),
    });
  }
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      jobId: req.params.jobId,
      status: "error",
      error: "Job not found",
    });
  }
  return res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.downloadUrl,
    error: job.error,
  });
});

app.get("/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job?.fileName) return res.status(404).send("Not found");
  return res.redirect(`/out/${job.fileName}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));
