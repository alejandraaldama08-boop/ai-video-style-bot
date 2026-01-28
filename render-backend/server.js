import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const app = express();
app.set("trust proxy", 1);

// --- Paths (ESM compatible) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Ensure uploads folder exists ---
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- CORS (permitir Lovable + Vercel + localhost) ---
const allowedOriginRegex = [
  /^https:\/\/.*\.lovable\.app$/,
  /^https:\/\/.*\.lovable\.dev$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.vercel\.app\/?$/,
  /^http:\/\/localhost:\d+$/,
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = allowedOriginRegex.some((re) => re.test(origin));
      if (ok) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight
app.options("*", cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// --- Serve uploads as static files ---
app.use("/uploads", express.static(UPLOAD_DIR));

// --- Multer setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

// --- Helpers ---
function baseUrlFromReq(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function isSameHostUploads(urlStr, req) {
  try {
    const u = new URL(urlStr);
    const base = new URL(baseUrlFromReq(req));
    return u.host === base.host && u.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

function localPathFromUploadsUrl(urlStr) {
  const u = new URL(urlStr);
  const filename = decodeURIComponent(u.pathname.replace("/uploads/", ""));
  // Seguridad básica: evita ../
  if (filename.includes("..")) return null;
  return path.join(UPLOAD_DIR, filename);
}

async function downloadToTemp(urlStr) {
  // Node 18+ tiene fetch
  const res = await fetch(urlStr);
  if (!res.ok) throw new Error(`Failed to download: ${urlStr} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tempName = `${Date.now()}-remote-${Math.random().toString(16).slice(2)}.bin`;
  const tempPath = path.join(UPLOAD_DIR, tempName);
  fs.writeFileSync(tempPath, buf);
  return tempPath;
}

function outputName() {
  return `render-${Date.now()}.mp4`;
}

// --- Health check ---
app.get("/health", async (req, res) => {
  execFile("ffmpeg", ["-version"], (err, stdout) => {
    if (err) return res.status(200).json({ ok: true, ffmpeg: false });
    const firstLine = (stdout || "").split("\n")[0];
    res.status(200).json({ ok: true, ffmpeg: firstLine });
  });
});

// --- Upload endpoint (POST) ---
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const baseUrl = baseUrlFromReq(req);
    const publicUrl = `${baseUrl}/uploads/${encodeURIComponent(req.file.filename)}`;

    return res.status(200).json({
      ok: true,
      url: publicUrl,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- RENDER endpoint (POST /render) ---
// Espera algo como:
// {
//   "clips":[{"url":"https://.../uploads/xxx.mp4","startTime":0,"order":0}],
//   "format":"reels",
//   "duration":30
// }
app.post("/render", async (req, res) => {
  try {
    const { clips, format, duration } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing clips[]" });
    }

    // 1) Resolver inputs a rutas locales (o descargar si vienen de fuera)
    const inputPaths = [];
    for (const c of clips) {
      if (!c?.url) continue;

      let p = null;
      if (isSameHostUploads(c.url, req)) {
        p = localPathFromUploadsUrl(c.url);
        if (!p || !fs.existsSync(p)) {
          throw new Error(`Local upload not found for url: ${c.url}`);
        }
      } else {
        // Si algún día metes URLs externas
        p = await downloadToTemp(c.url);
      }
      inputPaths.push(p);
    }

    if (inputPaths.length === 0) {
      return res.status(400).json({ ok: false, error: "No valid clip urls" });
    }

    // 2) Config de salida (Reels/TikTok = vertical 1080x1920, YouTube = 1920x1080)
    const isVertical = String(format || "").toLowerCase() !== "youtube";
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const outFile = outputName();
    const outPath = path.join(UPLOAD_DIR, outFile);

    // 3) Construir ffmpeg
    // - Si hay 1 clip: reencode + scale + trim a duration
    // - Si hay varios: concatenar y luego scale
    const dur = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 30;

    const args = [];

    // inputs
    for (const p of inputPaths) {
      args.push("-i", p);
    }

    // filter
    if (inputPaths.length === 1) {
      // scale + padding para mantener aspect ratio
      args.push(
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
      );
      args.push("-t", String(dur));
    } else {
      // concat multiple videos (asumimos que no hay audio o no importa)
      // normalizamos cada input con scale/pad y luego concat
      const filterParts = [];
      for (let i = 0; i < inputPaths.length; i++) {
        filterParts.push(
          `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
        );
      }
      const concatInputs = inputPaths.map((_, i) => `[v${i}]`).join("");
      filterParts.push(`${concatInputs}concat=n=${inputPaths.length}:v=1:a=0[vout]`);
      args.push("-filter_complex", filterParts.join(";"));
      args.push("-map", "[vout]");
      args.push("-t", String(dur));
    }

    // encoding
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

    await execFileAsync("ffmpeg", args);

    const baseUrl = baseUrlFromReq(req);
    const publicUrl = `${baseUrl}/uploads/${encodeURIComponent(outFile)}`;

    return res.status(200).json({ ok: true, url: publicUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "FFmpeg failed", details: String(e) });
  }
});

// Root
app.get("/", (req, res) => res.send("render-backend online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
