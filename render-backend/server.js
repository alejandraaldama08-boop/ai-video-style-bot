import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});
app.post("/generate", (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({
      ok: false,
      error: "No prompt provided"
    });
  }

  res.json({
    ok: true,
    receivedPrompt: prompt,
    message: "Generate endpoint working 🚀"
  });
});

app.get("/health", (req, res) => {
  // probamos que ffmpeg existe
  try {
    const out = execSync("ffmpeg -version", { stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .split("\n")[0];
    res.json({ ok: true, ffmpeg: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: "ffmpeg not available" });
  }
});

app.post("/render", async (req, res) => {
  // de momento: mock para comprobar que Lovable conecta
  const { plan, clips, music } = req.body || {};
  res.json({
    ok: true,
    message: "Render request received ✅ (mock)",
    received: {
      plan: !!plan,
      clipsCount: Array.isArray(clips) ? clips.length : 0,
      hasMusic: !!music
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carpeta donde guardamos videos temporales
const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Servir los archivos generados
app.use("/out", express.static(OUT_DIR));

app.post("/render", async (req, res) => {
  try {
    const { text = "Hola", seconds = 3 } = req.body || {};
    const safeSeconds = Math.max(1, Math.min(Number(seconds) || 3, 10));

    const id = `${Date.now()}`;
    const output = path.join(OUT_DIR, `demo-${id}.mp4`);

    // MP4 simple: fondo negro + texto en el centro
    // Nota: drawtext suele requerir fonts; por compatibilidad, hacemos versión SIN drawtext y luego mejoramos
    // Genera un mp4 negro (sirve para probar pipeline de render y entrega)
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${safeSeconds} -c:v libx264 -pix_fmt yuv420p "${output}"`,
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/out/demo-${id}.mp4`;

    res.json({
      ok: true,
      url,
      message: "MP4 generado correctamente ✅",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: "Error generando MP4",
      details: String(e?.message || e),
    });
  }
});
 
