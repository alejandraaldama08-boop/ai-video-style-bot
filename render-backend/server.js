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

// ✅ MUY IMPORTANTE en Render/Proxy (para que req.protocol / x-forwarded-proto funcionen)
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "100mb" }));

// =======================
// Carpetas
// =======================
const UPLOADS_DIR = path.join(__dirname, "uploads");
const RENDERS_DIR = path.join(__dirname, "renders");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });

// Static
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/renders", express.static(RENDERS_DIR));

// ✅ Helper para URLs seguras (evita mixed content)
function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || "https";
  return `${proto}://${req.get("host")}`;
}

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
  if (!file) return res.status(400).json({ ok: false, error: "No file" });

  console.log(`[UPLOAD] name=${file.originalname}, mime=${file.mimetype}, size=${file.size}`);

  const base = getBaseUrl(req);
  const url = `${base}/uploads/${encodeURIComponent(file.filename)}`;

  res.json({
    ok: true,
    url,
    name: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
  });
});

// =======================
// Health
// =======================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: true });
});

// =======================
// Render MP4 REAL (sync / sin jobs)
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

    // Resolver rutas locales desde URLs /uploads/...
    const toLocal = (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
      return path.join(UPLOADS_DIR, name);
    };

    const inputs = clips.map((c) => toLocal(c.url));

    inputs.forEach((p) => {
      if (!fs.existsSync(p)) {
        throw new Error(`Missing clip on server: ${p}`);
      }
    });

    // salida
    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // Construir filtros de concat de video
    const filter = [];
    for (let i = 0; i < inputs.length; i++) {
      filter.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      );
    }
    filter.push(inputs.map((_, i) => `[v${i}]`).join("") + `concat=n=${inputs.length}:v=1:a=0[vout]`);

    const args = ["-y"];

    // inputs video
    inputs.forEach((p) => args.push("-i", p));

    // music opcional
    let hasMusic = false;
    let musicLocal = null;
    if (music?.url) {
      musicLocal = toLocal(music.url);
      if (fs.existsSync(musicLocal)) {
        args.push("-i", musicLocal);
        hasMusic = true;
      } else {
        console.log(`[RENDER] music missing on server: ${musicLocal}`);
      }
    }

    args.push("-filter_complex", filter.join(";"));
    args.push("-map", "[vout]");

    if (hasMusic) {
      // La música es el último input: index = inputs.length
      args.push("-map", `${inputs.length}:a`, "-shortest", "-c:a", "aac");
    } else {
      args.push("-an");
    }

    if (duration) args.push("-t", String(duration));

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath
    );

    console.log(`[RENDER] inputs=${inputs.length}, hasMusic=${hasMusic}, out=${outName}`);
    if (hasMusic) console.log(`[RENDER] music=${musicLocal}`);

    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (err) {
        console.error("[FFMPEG ERROR]", stderr?.slice?.(0, 3000));
        return res.status(500).json({
          ok: false,
          error: "FFmpeg error",
          details: stderr?.slice?.(0, 3000),
        });
      }

      const base = getBaseUrl(req);
      const url = `${base}/renders/${encodeURIComponent(outName)}`;
      console.log(`[RENDER DONE] outName=${outName}, url=${url}`);

      // ✅ el frontend tuyo entiende url/videoUrl/outputUrl según casos:
      res.json({ ok: true, url, videoUrl: url, outputUrl: url });
    });
  } catch (e) {
    console.error("[RENDER ERROR]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
