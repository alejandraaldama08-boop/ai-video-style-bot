import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";

const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: true, // si quieres más estricto, te lo dejo luego fijado a tu dominio lovableproject
    credentials: false,
  })
);

// --------- ENV ---------
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// buckets (ya los creaste)
const BUCKET_UPLOADS = process.env.SUPABASE_BUCKET_UPLOADS || "uploads";
const BUCKET_RENDERS = process.env.SUPABASE_BUCKET_RENDERS || "renders";

// seguridad mínima
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --------- helpers ---------
function extFromName(name = "") {
  const ext = path.extname(name).toLowerCase();
  return ext && ext.length <= 8 ? ext : "";
}

function randId() {
  return crypto.randomBytes(16).toString("hex");
}

function publicUrl(bucket, objectPath) {
  // URL pública estándar Supabase Storage (bucket debe ser PUBLIC)
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function ensureTmpDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(outPath, buf);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function safeFilename(original = "file") {
  return original.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// --------- Multer (memory) ---------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 200 }, // 200MB (ajusta si quieres)
});

// --------- In-memory jobs ---------
const jobs = new Map(); // jobId -> { status, url?, error?, details? }

// --------- ROUTES ---------

app.get("/", (req, res) => {
  res.json({ ok: true, service: "render-backend", ffmpeg: !!ffmpegPath });
});

/**
 * POST /upload
 * form-data: file
 * -> sube a Supabase Storage bucket uploads
 * -> devuelve { url, name, mimetype, size }
 */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });

    const original = safeFilename(file.originalname || "upload");
    const ext = extFromName(original) || "";
    const objectPath = `${Date.now()}-${randId()}-${original || "file"}${ext && !original.endsWith(ext) ? ext : ""}`;

    const contentType = file.mimetype || "application/octet-stream";

    const { error } = await supabase.storage
      .from(BUCKET_UPLOADS)
      .upload(objectPath, file.buffer, {
        contentType,
        upsert: false,
      });

    if (error) throw new Error(`Supabase upload error: ${error.message}`);

    const url = publicUrl(BUCKET_UPLOADS, objectPath);

    res.json({
      url,
      name: original,
      mimetype: file.mimetype,
      size: file.size,
    });
  } catch (e) {
    console.error("❌ /upload error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /render
 * body: {
 *  clips: [{ url, name?, startTime?, order? }],
 *  music?: { url, name? },
 *  format: "tiktok" | "reels" | "youtube",
 *  duration: number
 * }
 * -> crea job y procesa async (pero en el mismo proceso)
 */
app.post("/render", async (req, res) => {
  const jobId = randId();
  jobs.set(jobId, { status: "starting" });

  // respondemos rápido
  res.json({ jobId });

  // procesamos en background (en el mismo proceso Node)
  (async () => {
    const startedAt = Date.now();
    try {
      jobs.set(jobId, { status: "processing" });

      const { clips = [], music = null, duration = 30 } = req.body || {};
      if (!Array.isArray(clips) || clips.length === 0) {
        throw new Error("No clips provided");
      }

      if (!ffmpegPath) {
        throw new Error("ffmpeg-static not available (ffmpegPath missing)");
      }

      // carpeta temporal
      const workDir = path.join(os.tmpdir(), `job-${jobId}`);
      await ensureTmpDir(workDir);

      // 1) descargar clips
      const localClips = [];
      const sorted = clips
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        if (!c?.url) throw new Error(`Clip missing url at index ${i}`);

        const name = safeFilename(c.name || `clip-${i}.mp4`);
        const ext = extFromName(name) || ".mp4";
        const outPath = path.join(workDir, `clip-${String(i).padStart(3, "0")}${ext}`);

        await downloadToFile(c.url, outPath);
        localClips.push(outPath);
      }

      // 2) descargar música si existe
      let localMusic = null;
      if (music?.url) {
        const mname = safeFilename(music.name || "music.mp3");
        const mext = extFromName(mname) || ".mp3";
        localMusic = path.join(workDir, `music${mext}`);
        await downloadToFile(music.url, localMusic);
      }

      // 3) concat (demuxer)
      // Creamos filelist.txt
      const listPath = path.join(workDir, "filelist.txt");
      const listContent = localClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fs.promises.writeFile(listPath, listContent);

      const outName = `render-${jobId}.mp4`;
      const outLocal = path.join(workDir, outName);

      // Concat base:
      const concatTmp = path.join(workDir, `concat-${jobId}.mp4`);
      await run(ffmpegPath, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        concatTmp,
      ]);

      // 4) recortar duración + añadir música opcional
      // Nota: para máxima compatibilidad, re-encodeamos aquí.
      const dur = Number(duration) || 30;

      if (localMusic) {
        // video + audio
        await run(ffmpegPath, [
          "-y",
          "-i",
          concatTmp,
          "-i",
          localMusic,
          "-t",
          String(dur),
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          outLocal,
        ]);
      } else {
        // solo video (mantiene audio original si hay, si no, sin audio)
        await run(ffmpegPath, [
          "-y",
          "-i",
          concatTmp,
          "-t",
          String(dur),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outLocal,
        ]);
      }

      // 5) subir render a Supabase bucket renders
      const outBuf = await fs.promises.readFile(outLocal);
      const objectPath = `${Date.now()}-${jobId}.mp4`;

      const { error } = await supabase.storage.from(BUCKET_RENDERS).upload(objectPath, outBuf, {
        contentType: "video/mp4",
        upsert: false,
      });
      if (error) throw new Error(`Supabase render upload error: ${error.message}`);

      const url = publicUrl(BUCKET_RENDERS, objectPath);

      jobs.set(jobId, {
        status: "done",
        url,
        outputUrl: url,
        tookMs: Date.now() - startedAt,
      });

      // limpieza best-effort
      fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    } catch (e) {
      console.error("❌ render job error:", e);
      jobs.set(jobId, {
        status: "error",
        error: String(e?.message || e),
        details: String(e?.stack || ""),
      });
    }
  })();
});

/**
 * GET /job/:id
 * -> devuelve status y url si está listo
 */
app.get("/job/:id", (req, res) => {
  const id = req.params.id;
  const data = jobs.get(id);
  if (!data) return res.status(404).json({ status: "not_found" });
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`✅ render-backend listening on :${PORT}`);
  console.log(`✅ buckets: uploads=${BUCKET_UPLOADS}, renders=${BUCKET_RENDERS}`);
});
