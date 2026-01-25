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
