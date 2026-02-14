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

// ✅ FIX: asegurar fetch global (evita "Supabase upload error: fetch failed" en Render)
import { fetch, Headers, Request, Response } from "undici";
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;

const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: true,
    credentials: false,
  })
);

// --------- ENV ---------
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET_UPLOADS = process.env.SUPABASE_BUCKET_UPLOADS || "uploads";
const BUCKET_RENDERS = process.env.SUPABASE_BUCKET_RENDERS || "renders";

// seguridad mínima
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch }, // ✅ usar fetch de undici explícitamente
});

// --------- helpers ---------
function randId() {
  return crypto.randomBytes(16).toString("hex");
}

function safeFilename(original = "file") {
  return original.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getPublicUrl(bucket, objectPath) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
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

// --------- Multer (memory) ---------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 200 }, // 200MB
});

// --------- In-memory jobs ---------
const jobs = new Map(); // jobId -> { status, url?, error?, details? }

// --------- ROUTES ---------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "render-backend",
    node: process.version,
    hasFetch: typeof fetch === "function",
    ffmpeg: !!ffmpegPath,
    ffmpegPath,
    buckets: { uploads: BUCKET_UPLOADS, renders: BUCKET_RENDERS },
  });
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

    console.log("---- /upload ----");
    console.log("Node:", process.version);
    console.log("SUPABASE_URL:", SUPABASE_URL ? "OK" : "MISSING");
    console.log("SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING");
    console.log("Bucket:", BUCKET_UPLOADS);
    console.log("File:", file.originalname, file.mimetype, file.size);

    // asegurar que existe buffer (memoryStorage)
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(500).json({
        error: "file.buffer vacío (multer memoryStorage no está funcionando)",
      });
    }

    const original = safeFilename(file.originalname || "upload");
    const objectPath = `${Date.now()}-${randId()}-${original}`;
    const contentType = file.mimetype || "application/octet-stream";

    const { data, error } = await supabase.storage
      .from(BUCKET_UPLOADS)
      .upload(objectPath, file.buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      console.error("❌ Supabase upload error object:", error);
      return res.status(500).json({
        error: "Supabase upload error",
        message: error.message,
        statusCode: error.statusCode,
        name: error.name,
        details: error,
      });
    }

    const url = getPublicUrl(BUCKET_UPLOADS, objectPath);

    return res.json({
      url,
      name: original,
      mimetype: file.mimetype,
      size: file.size,
      objectPath,
      storage: data,
    });
  } catch (e) {
    console.error("❌ /upload error:", e);
    return res.status(500).json({
      error: String(e?.message || e),
      stack: String(e?.stack || ""),
    });
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
 * -> crea job y procesa async (en el mismo proceso Node)
 */
app.post("/render", async (req, res) => {
  const jobId = randId();
  jobs.set(jobId, { status: "starting" });

  // respondemos rápido
  res.json({ jobId });

  (async () => {
    const startedAt = Date.now();
    let workDir = null;

    try {
      jobs.set(jobId, { status: "processing" });

      const { clips = [], music = null, duration = 30 } = req.body || {};
      if (!Array.isArray(clips) || clips.length === 0) {
        throw new Error("No clips provided");
      }
      if (!ffmpegPath) {
        throw new Error("ffmpeg-static not available (ffmpegPath missing)");
      }

      workDir = path.join(os.tmpdir(), `job-${jobId}`);
      await ensureTmpDir(workDir);

      // 1) descargar clips
      const sorted = clips.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const localClips = [];

      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        if (!c?.url) throw new Error(`Clip missing url at index ${i}`);

        const name = safeFilename(c.name || `clip-${i}.mp4`);
        const ext = path.extname(name) || ".mp4";
        const outPath = path.join(workDir, `clip-${String(i).padStart(3, "0")}${ext}`);

        await downloadToFile(c.url, outPath);
        localClips.push(outPath);
      }

      // 2) descargar música si existe
      let localMusic = null;
      if (music?.url) {
        const mname = safeFilename(music.name || "music.mp3");
        const mext = path.extname(mname) || ".mp3";
        localMusic = path.join(workDir, `music${mext}`);
        await downloadToFile(music.url, localMusic);
      }

      // 3) concat: SIEMPRE re-encode (más estable)
      const listPath = path.join(workDir, "filelist.txt");
      const listContent = localClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fs.promises.writeFile(listPath, listContent);

      const concatTmp = path.join(workDir, `concat-${jobId}.mp4`);

      await run(ffmpegPath, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
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
        concatTmp,
      ]);

      // 4) recortar duración + música opcional
      const dur = Math.max(1, Number(duration) || 30);
      const outLocal = path.join(workDir, `render-${jobId}.mp4`);

      if (localMusic) {
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

      const url = getPublicUrl(BUCKET_RENDERS, objectPath);

      jobs.set(jobId, {
        status: "done",
        url,
        outputUrl: url,
        tookMs: Date.now() - startedAt,
      });
    } catch (e) {
      console.error("❌ render job error:", e);
      jobs.set(jobId, {
        status: "error",
        error: String(e?.message || e),
        details: String(e?.stack || ""),
      });
    } finally {
      if (workDir) {
        fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  })();
});

/**
 * GET /job/:id
 */
app.get("/job/:id", (req, res) => {
  const id = req.params.id;
  const data = jobs.get(id);
  if (!data) return res.status(404).json({ status: "not_found" });
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`✅ render-backend listening on :${PORT}`);
  console.log(`✅ Node: ${process.version}`);
  console.log(`✅ fetch available: ${typeof fetch === "function"}`);
  console.log(`✅ ffmpegPath: ${ffmpegPath}`);
  console.log(`✅ buckets: uploads=${BUCKET_UPLOADS}, renders=${BUCKET_RENDERS}`);
});
