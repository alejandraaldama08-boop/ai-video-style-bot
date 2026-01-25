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

// Carpeta donde guardamos videos generados
const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Servir archivos generados
app.use("/out", express.static(OUT_DIR));

// Jobs en memoria (MVP)
const jobs = new Map(); // jobId -> { jobId, status, progress?, downloadUrl?, error? }

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

// ✅ Frontend espera POST /generate
app.post("/generate", async (req, res) => {
  try {
    // Puedes recibir config completo, pero de momento usamos duración sencilla
    const secondsRaw = req.body?.duration ?? req.body?.seconds ?? 3;
    const safeSeconds = Math.max(1, Math.min(Number(secondsRaw) || 3, 60));

    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    jobs.set(jobId, { jobId, status: "rendering", progress: 10 });

    const output = path.join(OUT_DIR, `demo-${jobId}.mp4`);

    // MP4 simple para validar pipeline
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${safeSeconds} -c:v libx264 -pix_fmt yuv420p "${output}"`,
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/out/demo-${jobId}.mp4`;
    const downloadUrl = `${baseUrl}/download/${jobId}`;

    const done = { jobId, status: "done", progress: 100, downloadUrl };
    jobs.set(jobId, done);

    // ✅ Devolvemos lo que el frontend espera
    return res.json(done);
  } catch (e) {
    console.error(e);
    const jobId = `${Date.now()}-error`;
    const err = { jobId, status: "error", error: String(e?.message || e) };
    jobs.set(jobId, err);
    return res.status(500).json(err);
  }
});

// ✅ Frontend espera GET /status/:jobId
app.get("/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ jobId, status: "error", error: "Job not found" });
  }
  return res.json(job);
});

// ✅ Frontend (api.ts) construye /download/:jobId
app.get("/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  const filePath = path.join(OUT_DIR, `demo-${jobId}.mp4`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  // Forzar descarga
  res.download(filePath, `video-${jobId}.mp4`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));
