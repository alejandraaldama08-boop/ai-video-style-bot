// src/lib/api.ts
// API client for Render backend (Render.com)

const API_URL = "https://ai-video-style-bot-3.onrender.com";

// ---------- TYPES ----------

export interface RenderJob {
  jobId: string;
  status: "pending" | "rendering" | "done" | "error";
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

export interface ClipInput {
  id: string;
  url: string; // MUST be public http(s) URL
  name: string;
  startTime?: number;
  endTime?: number;
  order: number;
}

export interface VideoConfig {
  clips: ClipInput[];
  music?: {
    url: string;
    volume?: number;
  };
  overlays?: {
    text: string;
    start: number;
    end: number;
  }[];
  format: "tiktok" | "reels" | "youtube";
  duration: number;
}

// ---------- HELPERS ----------

async function handleResponse(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- API CALLS ----------

/**
 * Upload a file to backend and receive a PUBLIC URL
 */
export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  const data = await handleResponse(res);

  if (!data?.url) {
    throw new Error("Upload failed: no URL returned");
  }

  return data.url; // public https URL
}

/**
 * Start video render
 */
export async function renderVideo(config: VideoConfig): Promise<RenderJob> {
  const res = await fetch(`${API_URL}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  return handleResponse(res);
}

/**
 * Check render status
 */
export async function getRenderStatus(jobId: string): Promise<RenderJob> {
  const res = await fetch(`${API_URL}/status/${jobId}`);
  return handleResponse(res);
}

/**
 * Health check (debug)
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
