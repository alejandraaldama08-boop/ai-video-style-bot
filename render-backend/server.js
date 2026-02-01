import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// IMPORTANT: Render/Proxies (para x-forwarded-proto)
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

// =======================
// Helpers
// =======================
function getBaseUrl(req) {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function safeName(original) {
  // Evita nombres raros que luego den problemas en URL o filesystem
  return String(original || "file")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

function isOurUploadsUrl(req, urlStr) {
  try {
    const u = new URL(urlStr);
    const host = req.get("host");
    return u.host === host && u.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

function localPathFromUploadsUrl(urlStr) {
  const u = new URL(urlStr);
  const filename = decodeURIComponent(u.pathname.split("/").pop() || "");
  return path.join(UPLOADS_DIR, filename);
}

// Descarga URL (http/https) -> destPath (/tmp/xxx)
function downloadToFile(urlStr, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlStr);
    } catch (e) {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }

    const getter = urlObj.protocol === "http:" ? http.get : https.get;

    const req = getter(
      urlStr,
      {
        headers: {
          "User-Agent": "render-backend/1.0",
        },
      },
      (res) => {
        // Redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (maxRedirects <= 0) {
            reject(new Error(`Too many redirects downloading: ${urlStr}`));
            return;
          }
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          res.resume();
          downloadToFile(nextUrl, destPath, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8").slice(0, 300);
            reject(new Error(`Download failed ${res.statusCode}: ${body}`));
          });
          return;
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);

        file.on("finish", () => file.close(() => resolve(destPath)));
        file.on("error", (err) => reject(err));
      }
    );

    req.on("error", (err) => reject(err));
  });
}

// Obtiene una ruta local usable por ffmpeg:
// 1) si es URL de /uploads y existe local -> usa local
// 2) si no existe -> descarga a /tmp
async function resolveToFfmpegLocalPath(req, urlStr, label = "input") {
  // Caso: URL de nuestro /uploads
  if (isOurUploadsUrl(req, urlStr)) {
    const local = localPathFromUploadsUrl(urlStr);
    if (fs.existsSync(local)) return local;

    // Si no existe (el típico error que tienes), intentamos descargar desde la URL igualmente
    const tmp = path.join("/tmp", `${Date.now()}-${label}-${path.basename(local)}`);
    await downloadToFile(urlStr, tmp);
    return tmp;
  }

  // Caso general: URL remota (S3, etc)
  const tmp = path.join("/tmp", `${Date.now()}-${label}-${safeName(path.basename(new URL(urlStr).pathname))}`);
  await downloadToFile(urlStr, tmp);
  return tmp;
}

// =======================
// Upload (clips + música)
// =======================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safe = safeName(file.originalname);
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024, // 250MB (ajusta si quieres)
  },
});

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file" });

  console.log(`[UPLOAD] name=${file.originalname} saved=${file.filename} mime=${file.mimetype} size=${file.size}`);

  const base = getBaseUrl(req);
  const url = `${base}/uploads/${encodeURIComponent(file.filename)}`;

  res.json({
    ok: true,
    url,
    name: file.originalname,
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
// Render MP4 (robusto con /tmp)
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

    // Orden
    const sortedClips = clips
      .slice()
      .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

    // Resolver a paths locales (si falta local, descarga a /tmp)
    const localInputs = [];
    for (let i = 0; i < sortedClips.length; i++) {
      const c = sortedClips[i];
      if (!c?.url) throw new Error("Clip missing url");
      const p = await resolveToFfmpegLocalPath(req, c.url, `clip${i}`);
      localInputs.push(p);
    }

    // Música (opcional)
    let musicPath = null;
    if (music?.url) {
      musicPath = await resolveToFfmpegLocalPath(req, music.url, "music");
    }

    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(RENDERS_DIR, outName);

    // Filtros de vídeo
    const filter = [];
    for (let i = 0; i < localInputs.length; i++) {
      filter.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      );
    }

    filter.push(
      localInputs.map((_, i) => `[v${i}]`).join("") +
        `concat=n=${localInputs.length}:v=1:a=0[vout]`
    );

    const args = ["-y"];

    // inputs video
    localInputs.forEach((p) => args.push("-i", p));

    // input audio
    const hasMusic = Boolean(musicPath);
    if (hasMusic) args.push("-i", musicPath);

    args.push("-filter_complex", filter.join(";"));
    args.push("-map", "[vout]");

    if (hasMusic) {
      args.push("-map", `${localInputs.length}:a`, "-shortest", "-c:a", "aac");
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

    console.log("[RENDER] ffmpeg args:", args.join(" "));

    execFile("ffmpeg", args, (err, _stdout, stderr) => {
      if (err) {
        console.error("[RENDER] ffmpeg error:", stderr?.slice?.(0, 2000));
        return res.status(500).json({
          ok: false,
          error: "FFmpeg error",
          details: stderr?.slice?.(0, 3000),
        });
      }

      const base = getBaseUrl(req);
      const url = `${base}/renders/${encodeURIComponent(outName)}`;

      console.log(`[RENDER] OK -> ${url}`);
      res.json({ ok: true, url, videoUrl: url });
    });
  } catch (e) {
    console.error("[RENDER] ERROR:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
