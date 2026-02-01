import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// IMPORTANT: render / proxies
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "200mb" }));

// =======================
// Env (Render)
// =======================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_ROLE_KEY || "");

// Buckets
const BUCKET_UPLOADS = "uploads";
const BUCKET_RENDERS = "renders";

// =======================
// Local temp folders (Render ephemeral ok)
// =======================
const TMP_DIR = path.join(__dirname, "tmp");
const TMP_UPLOADS = path.join(TMP_DIR, "uploads");
const TMP_RENDERS = path.join(TMP_DIR, "renders");

fs.mkdirSync(TMP_UPLOADS, { recursive: true });
fs.mkdirSync(TMP_RENDERS, { recursive: true });

// Optional local debug access (not required)
app.use("/tmp/uploads", express.static(TMP_UPLOADS));
app.use("/tmp/renders", express.static(TMP_RENDERS));

function getBaseUrl(req) {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function safeName(name) {
  return name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => "");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

// =======================
// Multer (memory) -> Supabase
// =======================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 300 }, // 300MB
});

// Build public URL for a stored object
function publicUrl(bucket, key) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return data?.publicUrl;
}

// =======================
// Upload endpoint (clips + music)
// =======================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "No file" });

    // Basic logging
    console.log(
      `[UPLOAD] name=${file.originalname} mime=${file.mimetype} size=${file.size}`
    );

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Supabase env vars missing on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const key = `${Date.now()}-${safeName(file.originalname)}`;

    const { error } = await supabase.storage
      .from(BUCKET_UPLOADS)
      .upload(key, file.buffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (error) {
      console.error("[UPLOAD] supabase error:", error);
      return res.status(500).json({ ok: false, error: `Supabase upload error: ${error.message}` });
    }

    const url = publicUrl(BUCKET_UPLOADS, key);

    if (!url) {
      return res.status(500).json({ ok: false, error: "Could not get public URL from Supabase" });
    }

    res.json({
      ok: true,
      url,
      key,
      mimetype: file.mimetype,
      size: file.size,
      name: file.originalname,
      // base: getBaseUrl(req), // if you want to debug
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =======================
// Health
// =======================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: true, storage: "supabase" });
});

// =======================
// Helper: download remote URL -> local file
// =======================
async function downloadToFile(url, outPath) {
  const r = await fetch(url);
  if (!r.ok) {
    const { text } = await readJsonSafe(r);
    throw new Error(`Download failed ${r.status}: ${text?.slice?.(0, 400) || ""}`);
  }
  const arr = new Uint8Array(await r.arrayBuffer());
  fs.writeFileSync(outPath, arr);
}

// =======================
// Render MP4 (sync style) + upload result to Supabase renders
// =======================
app.post("/render", async (req, res) => {
  try {
    const { clips = [], music, format = "reels", duration } = req.body || {};

    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ ok: false, error: "No clips provided" });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Supabase env vars missing on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const isVertical = format !== "youtube";
    const W = isVertical ? 1080 : 1920;
    const H = isVertical ? 1920 : 1080;

    // 1) Download all clips to temp
    const sorted = clips.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const inputPaths = [];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      if (!c?.url) throw new Error("Clip missing url");
      const local = path.join(TMP_UPLOADS, `${Date.now()}-clip-${i}.mp4`);
      await downloadToFile(c.url, local);
      inputPaths.push(local);
    }

    // 2) Optional music download
    let musicPath = null;
    if (music?.url) {
      const local = path.join(TMP_UPLOADS, `${Date.now()}-music`);
      // keep extension if possible
      const ext = (music.url.split("?")[0].split(".").pop() || "mp3").slice(0, 6);
      musicPath = `${local}.${ext}`;
      await downloadToFile(music.url, musicPath);
    }

    // 3) ffmpeg output
    const outName = `${Date.now()}-render.mp4`;
    const outPath = path.join(TMP_RENDERS, outName);

    // Filter graph: scale + pad each clip then concat
    const filter = [];
    for (let i = 0; i < inputPaths.length; i++) {
      filter.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      );
    }
    filter.push(
      inputPaths.map((_, i) => `[v${i}]`).join("") +
        `concat=n=${inputPaths.length}:v=1:a=0[vout]`
    );

    const args = ["-y"];
    inputPaths.forEach((p) => args.push("-i", p));
    if (musicPath) args.push("-i", musicPath);

    args.push("-filter_complex", filter.join(";"));
    args.push("-map", "[vout]");

    if (musicPath) {
      // music is last input
      args.push("-map", `${inputPaths.length}:a`, "-shortest", "-c:a", "aac");
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

    // 4) Run ffmpeg
    await new Promise((resolve, reject) => {
      execFile("ffmpeg", args, (err, _out, stderr) => {
        if (err) {
          console.error("[FFMPEG] error:", stderr?.slice?.(0, 2000));
          return reject(new Error(stderr?.slice?.(0, 3000) || "FFmpeg error"));
        }
        resolve(true);
      });
    });

    // 5) Upload output to Supabase renders
    const buffer = fs.readFileSync(outPath);
    const key = outName;

    const { error } = await supabase.storage.from(BUCKET_RENDERS).upload(key, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });

    if (error) {
      console.error("[RENDER UPLOAD] supabase error:", error);
      return res.status(500).json({ ok: false, error: `Supabase render upload error: ${error.message}` });
    }

    const url = publicUrl(BUCKET_RENDERS, key);
    if (!url) {
      return res.status(500).json({ ok: false, error: "Could not get public URL for render" });
    }

    console.log(`[RENDER] ok url=${url}`);

    // 6) Cleanup temp files (best-effort)
    try {
      inputPaths.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
      if (musicPath && fs.existsSync(musicPath)) fs.unlinkSync(musicPath);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {}

    res.json({ ok: true, url, videoUrl: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🎬 Render backend listening on", PORT);
});
