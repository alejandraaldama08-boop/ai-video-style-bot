import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ IMPORTANTE en Render / proxies
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

app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/renders", express.static(RENDERS_DIR));

// =======================
// Helpers
// =======================
function getBaseUrl(req) {
  // Render envía el proto real aquí
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

function safeFilename(originalname) {
  // Más robusto que solo espacios (evita paréntesis/raros)
  return originalname
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
}

function filenameFromUrl(url) {
  const u = new URL(url);
  const last = u.pathname.split("/").pop() || "";
  return decodeURIComponent(last);
}

async function downloadToFile(url, destPath) {
  // Node 18+ tiene fetch global
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed ${res.status}: ${text.slice(0, 300)}`);
  }
  await pipeline(res.body, fs.createWriteStream(destPath));
  return destPath;
}

async function ensureLocalFile(url) {
  const name = filenameFromUrl(url);
  const localPath = path.join(UPLOADS_DIR, name);

  if (fs.existsSync(localPath)) return localPath;

  // Si no existe local, lo descargamos desde la URL (soluciona multi-instancia/restart)
  console.log(`[ENSURE] missing locally, downloading: ${url} -> ${localPath}`);
  await downloadToFile(url, localPath);

  if (!fs.existsSync(localPath)) {
    throw new Error(`Still missing after download: ${localPath}`);
  }
  return localPath;
}

// =======================
// Upload (clips + música)
// =======================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safe = safeFilename(file.originalname);
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  // opcional: sube el límite si quieres
  limits: { fileSize: 1024 * 1024 * 500 }, // 500MB
});

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file" });

  console.log(`[UPLOAD] name=${file.originalname}, saved=${file.filename}, mime=${file.mimetype}, size=${file.size}`);

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

    // ✅ Asegura que todos los clips existen localmente (si no, los descarga)
    const inputs = [];
    for (const c of clips) {
      if (!c?.url) throw new Error("Clip missing url");
      const local = await ensureLocalFile(c.url);
      inputs.push(local);
    }

    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // Construir filtros (concat de varios clips)
    const filter = [];
    for (let i = 0; i < inputs.length; i++) {
      filter.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      );
    }
    filter.push(inputs.map((_, i) => `[v${i}]`).join("") + `concat=n=${inputs.length}:v=1:a=0[vout]`);

    const args = ["-y"];
    inputs.forEach((p) => args.push("-i", p));

    // Música (opcional) => también aseguramos local
    let hasMusic = false;
    if (music?.url) {
      try {
        const m = await ensureLocalFile(music.url);
        args.push("-i", m);
        hasMusic = true;
      } catch (e) {
        console.log(`[MUSIC] could not use music: ${String(e)}`);
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

    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (err) {
        console.log("[FFMPEG ERROR]", stderr?.slice?.(0, 3000));
        return res.status(500).json({
          ok: false,
          error: "FFmpeg error",
          details: stderr?.slice?.(0, 3000),
        });
      }

      const base = getBaseUrl(req);
      const url = `${base}/renders/${encodeURIComponent(outName)}`;

      console.log(`[RENDER] out=${outPath} url=${url}`);
      res.json({ ok: true, url, videoUrl: url });
    });
  } catch (e) {
    console.log("[RENDER ERROR]", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
