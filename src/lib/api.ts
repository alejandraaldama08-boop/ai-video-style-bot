const API_URL = "https://ai-video-style-bot-3.onrender.com";

export interface RenderJob {
  jobId: string;
  status: 'pending' | 'rendering' | 'done' | 'error';
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

export async function generateVideo(config: any): Promise<RenderJob> {
  const response = await fetch(`${API_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error('Failed to start render job');
  }

  return response.json();
}

export async function getRenderStatus(jobId: string): Promise<RenderJob> {
  const response = await fetch(`${API_URL}/status/${jobId}`);
  if (!response.ok) {
    throw new Error('Failed to get render status');
  }
  return response.json();
}

export function getDownloadUrl(jobId: string) {
  return `${API_URL}/download/${jobId}`;
}
