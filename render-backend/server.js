import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
app.use("/out", express.static(OUT_DIR));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.post("/render", (req, res) => {
  const clipUrl = req.body?.clips?.[0]?.url;

  if (!clipUrl) {
    return res.status(400).json({
      ok: false,
      error: "Missing clips[0].url"
    });
  }

  const id = Date.now();
  const output = path.join(OUT_DIR, `render-${id}.mp4`);

  const cmd = `
    ffmpeg -y -i "${clipUrl}"
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    -c:v libx264 -preset veryfast -crf 22
    -pix_fmt yuv420p
    -movflags +faststart
    "${output}"
  `;

  exec(cmd, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        error: "FFmpeg failed"
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      ok: true,
      url: `${baseUrl}/out/render-${id}.mp4`
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Render backend listening on", PORT));


