// src/lib/api.ts
// API configuration for Render backend
const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  "https://ai-video-style-bot-3.onrender.com";

export type RenderStatus = "pending" | "rendering" | "done" | "error";

export interface RenderJob {
  jobId: string;
  status: RenderStatus;
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

export interface ClipInput {
  id: string;
  url?: string;        // puede ser blob: o http(s)
  file?: File;         // si lo tienes en memoria (recomendado)
  name?: string;
  startTime?: number;
  endTime?: number;
  order?: number;
}

export interface MusicInput {
  url?: string;        // blob: o http(s)
  file?: File;
  name?: string;
  volume?: number;
}

export interface TextOverlay {
  text: string;
  start?: number;
  end?: number;
  position?: "center" | "top" | "bottom";
}

export interface SubtitleConfig {
  enabled: boolean;
  language?: string;
}

export interface VideoConfig {
  clips: ClipInput[];
  music?: MusicInput;
  youtubeLinks?: string[];
  style?: any;
  duration?: number;
  format?: "tiktok" | "reels" | "youtube";
  overlays?: TextOverlay[];
  subtitles?: SubtitleConfig;
  plan?: any;
}

function joinUrl(base: string, path: string) {
  if (!base) return path;
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
  return base + path;
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

async function uploadToBackend(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(joinUrl(API_URL, "/upload"), {
    method: "POST",
    body: fd,
  });

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.ok || !data?.url) {
    throw new Error(data?.error || "Upload failed");
  }
  return data.url as string;
}

/**
 * Convierte un clip en URL pública:
 * - Si ya es http(s) => se deja igual
 * - Si es blob: => requiere file (o fallará)
 * - Si hay file => se sube al backend y se devuelve URL pública
 */
async function ensurePublicUrl(input: { url?: string; file?: File }, label: string): Promise<string> {
  const url = input.url;

  // Si ya es pública
  if (url && /^https?:\/\//i.test(url)) return url;

  // Si hay file, subimos (sirve para blob: o url vacía)
  if (input.file) {
    return await uploadToBackend(input.file);
  }

  // Si llega blob: pero sin File => no hay manera de que el backend lo lea
  if (url && url.startsWith("blob:")) {
    throw new Error(
      `${label} es blob: (local del navegador). Necesito el File para subirlo a /upload.`
    );
  }

  throw new Error(`${label} no tiene url pública ni File para subir.`);
}

export async function healthCheck() {
  const res = await fetch(joinUrl(API_URL, "/health"));
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.error || "Health check failed");
  return data;
}

export async function renderVideo(config: VideoConfig): Promise<{ ok: true; url: string; message?: string }>{
  // 1) Asegurar clips en URL pública
  const clips = await Promise.all(
    (config.clips || []).map(async (c, idx) => {
      const publicUrl = await ensurePublicUrl(
        { url: c.url, file: c.file },
        `Clip ${idx + 1}`
      );

      return {
        ...c,
        url: publicUrl,
      };
    })
  );

  // 2) Asegurar música si existe
  let music: any = undefined;
  if (config.music) {
    const musicUrl = await ensurePublicUrl(
      { url: config.music.url, file: config.music.file },
      "Música"
    );
    music = { ...config.music, url: musicUrl };
  }

  // 3) Llamar a /render con URLs públicas
  const payload = {
    ...config,
    clips,
    music,
  };

  const res = await fetch(joinUrl(API_URL, "/render"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Render failed");
  }

  // backend devuelve {ok:true, url: ".../out/....mp4"}
  return data;
}
