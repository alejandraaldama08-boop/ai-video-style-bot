import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, "out");
const TMP_DIR = path.join(__dirname, "tmp");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

app.use("/out", express.static(OUT_DIR));

/* -------------------- helpers -------------------- */

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);

    proto
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

/* -------------------- routes -------------------- */

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", message: "Online ✅" });
});

app.get("/health", (req, res) => {
  try {
    const out = execSync("ffmpeg -version").toString().split("\n")[0];
    res.json({ ok: true, ffmpeg: out });
  } catch {
    res.status(500).json({ ok: false, error: "ffmpeg not available" });
  }
});

app.post("/render", async (req, res) => {
  try {
    const { clips = [], duration = 10 } = req.body;

    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    const localFiles = [];

    // 1️⃣ download clips
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (!clip.url || !clip.url.startsWith("http")) {
        return res.status(400).json({
          ok: false,
          error: "Clip URL must be public http(s)",
        });
      }

      const localPath = path.join(TMP_DIR, `clip-${Date.now()}-${i}.mp4`);
      await downloadFile(clip.url, localPath);
      localFiles.push(localPath);
    }

    // 2️⃣ concat list
    const listFile = path.join(TMP_DIR, `list-${Date.now()}.txt`);
    fs.writeFileSync(
      listFile,
      localFiles.map((f) => `file '${f}'`).join("\n")
    );

    // 3️⃣ render
    const output = path.join(OUT_DIR, `render-${Date.now()}.mp4`);

    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -t ${duration} -c:v libx264 -pix_fmt yuv420p "${output}"`,
      { stdio: "inherit" }
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      ok: true,
      url: `${baseUrl}/out/${path.basename(output)}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: "FFmpeg failed",
      details: String(e.message || e),
    });
  }
});

/* -------------------- start -------------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("render-backend listening on", PORT);
});
