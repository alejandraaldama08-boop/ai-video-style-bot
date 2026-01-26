// src/lib/api.ts
// API client for Render backend (ai-video-style-bot-3)

const API_URL =
  import.meta.env.VITE_API_URL || "https://ai-video-style-bot-3.onrender.com";

export interface RenderJob {
  jobId: string;
  status: "pending" | "rendering" | "done" | "error";
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

export interface VideoConfig {
  clips: ClipInput[];
  music?: MusicInput;
  youtubeLinks?: YouTubeInput[];
  style: VideoStyle;
  duration: number;
  format: "tiktok" | "reels" | "youtube";
  overlays: TextOverlay[];
  subtitles?: SubtitleConfig;
}

export interface ClipInput {
  id: string;
  url: string;
  name: string;
  startTime?: number;
  endTime?: number;
  order: number;
}

export interface MusicInput {
  url: string;
  name: string;
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface YouTubeInput {
  url: string;
  startTime?: number;
  endTime?: number;
}

export interface VideoStyle {
  name: "cinematic" | "vlog" | "street" | "elegant" | "dynamic";
  transitions: boolean;
  zoom: boolean;
  beatSync: boolean;
}

export interface TextOverlay {
  text: string;
  position: "top" | "center" | "bottom";
  style: "modern" | "minimal" | "bold";
}

export interface SubtitleConfig {
  enabled: boolean;
  style: "modern" | "minimal" | "bold";
}

// Helpers
function makeJobId() {
  return crypto.randomUUID();
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// API functions
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start render.
 * Tu backend actual genera un MP4 en POST /render y devuelve { ok: true, url }.
 * Aquí lo transformamos a RenderJob con status 'done' y downloadUrl = url del mp4.
 */
export async function generateVideo(config: VideoConfig): Promise<RenderJob> {
  try {
    // En esta fase "mock-real": el backend no usa clips aún.
    // Para probar pipeline, mandamos un texto y segundos basado en duration.
    const seconds = Math.max(1, Math.min(Number(config?.duration) || 3, 10));

    // Si quieres que el texto cambie, lo puedes mejorar luego.
    const text =
      (config?.overlays?.[0]?.text ||
        `Video ${config.format} (${config.style?.name || "style"})`) ?? "Hola";

    const res = await fetch(`${API_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        seconds,
        // dejamos el config completo por si luego lo usas en backend
        config,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Failed to start render job");
    }

    // Backend devuelve { ok: true, url, message }
    const url: string | undefined = data?.url;

    if (!url) {
      throw new Error("Render response did not include a video url");
    }

    return {
      jobId: makeJobId(),
      status: "done",
      progress: 100,
      downloadUrl: url,
    };
  } catch (err) {
    return {
      jobId: makeJobId(),
      status: "error",
      error: normalizeError(err),
    };
  }
}

/**
 * Status polling (tu backend aún no tiene /status/:jobId real).
 * Por ahora devolvemos 'done' si existe downloadUrl o 'error' si no.
 * (Esto evita que PreviewPanel se quede esperando.)
 */
export async function getRenderStatus(jobId: string): Promise<RenderJob> {
  // Si luego implementas /status/:jobId en backend, cambia esto:
  // const res = await fetch(`${API_URL}/status/${jobId}`) ...
  return {
    jobId,
    status: "done",
    progress: 100,
  };
}

/**
 * Download URL helper.
 * Tu backend real ahora devuelve un mp4 directo en /out/...mp4,
 * así que PreviewPanel debe usar downloadUrl directo.
 * Si implementas /download/:jobId en backend, aquí lo conectas.
 */
export async function getDownloadUrl(jobId: string): Promise<string> {
  return `${API_URL}/download/${jobId}`;
}

/**
 * Upload file (tu backend aún no tiene /upload).
 * Lo dejamos para después. Si no lo usas, no pasa nada.
 */
export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error("Failed to upload file");
  }

  const data = await res.json();
  return data.url;
}
