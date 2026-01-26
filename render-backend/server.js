import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
app.use("/out", express.static(OUT_DIR));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.get("/health", async (req, res) => {
  res.json({ ok: true });
});

// Descarga una URL a un archivo local
async function downloadToFile(url, destPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${r.statusText}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

app.post("/render", async (req, res) => {
  try {
    const clipUrl = req.body?.clips?.[0]?.url;

    if (!clipUrl) {
      return res.status(400).json({ ok: false, error: "Missing clips[0].url" });
    }

    // Si Lovable manda blob: esto NO se puede renderizar en servidor
    if (String(clipUrl).startsWith("blob:")) {
      return res.status(400).json({
        ok: false,
        error:
          "Lovable is sending a blob: URL (local browser URL). Backend cannot access it. You must upload the file and send a public http(s) URL.",
        got: clipUrl,
      });
    }

    const id = Date.now();
    const input = path.join(OUT_DIR, `input-${id}.mp4`);
    const output = path.join(OUT_DIR, `render-${id}.mp4`);

    // Descargamos primero a local (esto evita problemas de ffmpeg leyendo https directo)
    await downloadToFile(clipUrl, input);

    // Render vertical 1080x1920
    const cmd =
      `ffmpeg -y -i "${input}" ` +
      `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" ` +
      `-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart ` +
      `"${output}"`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({
          ok: false,
          error: "FFmpeg failed",
          // Lo importante: el motivo real
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
    res.status(500).json({
      ok: false,
      error: "Render handler crashed",
      details: String(e?.message || e).slice(0, 2000),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Render backend listening on", PORT));
