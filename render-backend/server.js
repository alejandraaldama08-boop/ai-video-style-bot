import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ---------- Paths / folders ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Serve generated videos
app.use("/out", express.static(OUT_DIR, {
  setHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
}));

// ---------- Helpers ----------
function nowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Basic “safe” number
function clampNum(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

// ---------- Routes ----------
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

// Test endpoint (lo tienes ya)
app.post("/generate", (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ ok: false, error: "No prompt provided" });
  }
  res.json({ ok: true, receivedPrompt: prompt, message: "Generate endpoint working 🚀" });
});

/**
 * MAIN: /render
 * Espera algo tipo:
 * {
 *   clips: [{ url: "https://..." }],
 *   format: "reels" | "tiktok" | "youtube",
 *   duration: 10,
 *   startTime: 0 (opcional)
 * }
 *
 * Devuelve:
 * { ok:true, status:"done", progress:100, url:"https://.../out/<id>.mp4", downloadUrl:"..." }
 */
app.post("/render", async (req, res) => {
  try {
    const body = req.body || {};

    // Soportamos que clips venga en body.clips o body.input.clips etc
    const clips = body.clips || body?.input?.clips || [];
    const format = (body.format || body.platform || "reels").toString().toLowerCase();

    // Pillamos el primer clip (por ahora)
    const firstClipUrl = Array.isArray(clips) && clips[0]?.url ? String(clips[0].url) : null;

    if (!firstClipUrl) {
      return res.status(400).json({
        ok: false,
        error: "No clip url provided. Expected body.clips[0].url"
      });
    }

    // Duración final (segundos)
    const duration = clampNum(body.duration ?? body.seconds, 1, 60, 10);

    // Inicio (si quieres recortar desde un punto)
    const startTime =
      clampNum(body.startTime ?? clips?.[0]?.startTime ?? 0, 0, 3600, 0);

    const id = nowId();
    const output = path.join(OUT_DIR, `render-${id}.mp4`);

    // Targets por formato
    // Reels/TikTok: vertical 1080x1920
    // YouTube: 1920x1080
    const isVertical = format === "reels" || format === "tiktok";
    const targetW = isVertical ? 1080 : 1920;
    const targetH = isVertical ? 1920 : 1080;

    // Filtro: escala + crop centrado para rellenar (sin barras)
    // scale: hace que cubra el lienzo, crop recorta el sobrante
    const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`;

    // ⚠️ Importantísimo:
    // - Usamos -ss y -t para recortar
    // - ffmpeg puede leer URLs HTTPS directamente (normalmente en Render funciona)
    // - -movflags +faststart para que se reproduzca rápido al abrir
    const cmd = [
      "ffmpeg",
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", `"${firstClipUrl}"`,
      "-vf", `"${vf}"`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      `"${output}"`
    ].join(" ");

    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/out/render-${id}.mp4`;

    res.json({
      ok: true,
      status: "done",
      progress: 100,
      jobId: id,
      url,
      downloadUrl: url,
      message: "Render completed ✅"
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      status: "error",
      error: "Error rendering video",
      details: String(e?.message || e)
    });
  }
});

// Simple download alias (por si el front usa /download/<id>)
app.get("/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  const file = path.join(OUT_DIR, `render-${jobId}.mp4`);

  if (!fs.existsSync(file)) {
    return res.status(404).json({ ok: false, error: "File not found" });
  }

  // fuerza descarga
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="render-${jobId}.mp4"`);
  fs.createReadStream(file).pipe(res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));

