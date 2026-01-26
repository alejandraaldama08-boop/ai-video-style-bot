import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.set("trust proxy", 1); // 👈 clave para que req.protocol sea https en Render

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// output folder
const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
app.use("/out", express.static(OUT_DIR));

// root
app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

// health (ffmpeg)
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

// OPTIONAL: generate (test)
app.post("/generate", (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: "No prompt provided" });
  res.json({ ok: true, receivedPrompt: prompt, message: "Generate endpoint working 🚀" });
});

// ✅ REAL RENDER: creates MP4 and returns url
app.post("/render", async (req, res) => {
  try {
    const { text = "HOLA DESDE MI WEB", seconds = 3 } = req.body || {};
    const safeSeconds = Math.max(1, Math.min(Number(seconds) || 3, 10));

    const id = `${Date.now()}`;
    const output = path.join(OUT_DIR, `demo-${id}.mp4`);

    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${safeSeconds} -c:v libx264 -pix_fmt yuv420p "${output}"`,
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/out/demo-${id}.mp4`;

    res.json({ ok: true, url, message: "MP4 generado correctamente ✅" });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: "Error generando MP4",
      details: String(e?.message || e),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-backend listening on", PORT));

