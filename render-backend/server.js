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
const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false });

  const url = `${req.protocol}://${req.get("host")}/uploads/${encodeURIComponent(file.filename)}`;
  res.json({ ok: true, url });
});

// =======================
// Health
// =======================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: true });
});

// =======================
// Render MP4 REAL
// =======================
app.post("/render", async (req, res) => {
  try {
    const { clips = [], music, format = "reels", duration } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    const isVertical = format !== "youtube";
    const W = isVertical ? 1080 : 1920;
    const H = isVertical ? 1920 : 1080;

    // Resolver rutas locales
    const toLocal = (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
      return path.join(UPLOADS_DIR, name);
    };

    const inputs = clips.map(c => toLocal(c.url));
    inputs.forEach(p => {
      if (!fs.existsSync(p)) throw new Error("Missing clip on server");
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
    filter.push(
      inputs.map((_, i) => `[v${i}]`).join("") +
      `concat=n=${inputs.length}:v=1:a=0[vout]`
    );

    const args = ["-y"];
    inputs.forEach(p => args.push("-i", p));

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

    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath
    );

    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (err) {
        return res.status(500).json({
          ok: false,
          error: "FFmpeg error",
          details: stderr?.slice?.(0, 3000)
        });
      }

      const url = `${req.protocol}://${req.get("host")}/renders/${encodeURIComponent(outName)}`;
      res.json({ ok: true, url, videoUrl: url });
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
