import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ChatPanel } from "@/components/ChatPanel";
import { EditPlanViewer } from "@/components/EditPlanViewer";
import StoreSmokeTest from "@/components/StoreSmokeTest";

type UploadedFile = { url: string; name?: string };
type ClipItem = { url: string; name?: string; order: number; startTime?: number };

type PlanResponse =
  | {
      success: boolean;
      message: string;
      plan?: {
        steps?: unknown[];
        timeline?: unknown[];
        [key: string]: unknown;
      };
    }
  | null;

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://localhost:3000";

async function uploadOne(file: File): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  const data = await res.json().catch(() => ({} as any));
  if (!data?.url) throw new Error("Upload response missing url");
  return { url: data.url, name: data.name || file.name };
}

async function createRenderJob(payload: any): Promise<{ jobId: string }> {
  const res = await fetch(`${API_URL}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Render failed (${res.status}): ${text}`);
  }

  const data = await res.json().catch(() => ({} as any));
  const jobId = data.jobId || data.id || data.job_id;
  if (!jobId) throw new Error("Render response missing jobId");
  return { jobId };
}

async function pollJob(jobId: string): Promise<{ outputUrl?: string; status?: string; error?: string }> {
  const res = await fetch(`${API_URL}/job/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Job poll failed (${res.status}): ${text}`);
  }
  const data = await res.json().catch(() => ({} as any));
  return data;
}

async function generatePlan(messages: { role: "user" | "assistant"; content: string }[], context: any) {
  const res = await fetch(`${API_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Plan failed (${res.status}): ${text}`);
  }

  const data = await res.json().catch(() => ({} as any));

  // Soporta varios formatos posibles
  if (data?.plan) {
    return {
      success: true,
      message: "Plan generado correctamente",
      plan: data.plan,
    };
  }

  if (typeof data?.success === "boolean") return data as any;

  return {
    success: true,
    message: "Plan generado",
    plan: data,
  };
}

export default function ClipForge() {
  // Inputs
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [music, setMusic] = useState<UploadedFile | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<UploadedFile | null>(null);

  // Settings
  const [format, setFormat] = useState<"tiktok" | "reels" | "youtube">("reels");
  const [duration, setDuration] = useState<number>(30);

  // Plan / Chat
  const [plan, setPlan] = useState<PlanResponse>(null);

  // Render
  const [isUploadingClips, setIsUploadingClips] = useState(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  const [isRendering, setIsRendering] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Refs for file inputs
  const clipInputRef = useRef<HTMLInputElement | null>(null);
  const musicInputRef = useRef<HTMLInputElement | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);

  const chatContext = useMemo(
    () => ({
      clips,
      format,
      duration,
      music: music ? { url: music.url, name: music.name } : null,
      referenceVideo: referenceVideo ? { url: referenceVideo.url, name: referenceVideo.name } : null,
    }),
    [clips, format, duration, music, referenceVideo]
  );

  async function handleUploadClips(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploadingClips(true);
    try {
      const uploaded: ClipItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const up = await uploadOne(f);
        uploaded.push({ url: up.url, name: up.name, order: i, startTime: 0 });
      }
      // si ya había clips, los añadimos al final reordenando
      setClips((prev) => {
        const base = prev.slice();
        const startOrder = base.length;
        const merged = base.concat(
          uploaded.map((c, idx) => ({
            ...c,
            order: startOrder + idx,
          }))
        );
        return merged;
      });
    } catch (e: any) {
      alert(e?.message || "Error subiendo clips");
      console.error(e);
    } finally {
      setIsUploadingClips(false);
      if (clipInputRef.current) clipInputRef.current.value = "";
    }
  }

  async function handleUploadMusic(file: File | null) {
    if (!file) return;
    setIsUploadingMusic(true);
    try {
      const up = await uploadOne(file);
      setMusic(up);
    } catch (e: any) {
      alert(e?.message || "Error subiendo música");
      console.error(e);
    } finally {
      setIsUploadingMusic(false);
      if (musicInputRef.current) musicInputRef.current.value = "";
    }
  }

  async function handleUploadReference(file: File | null) {
    if (!file) return;
    setIsUploadingRef(true);
    try {
      const up = await uploadOne(file);
      setReferenceVideo(up);
    } catch (e: any) {
      alert(e?.message || "Error subiendo vídeo de referencia");
      console.error(e);
    } finally {
      setIsUploadingRef(false);
      if (refInputRef.current) refInputRef.current.value = "";
    }
  }

  async function handleRender() {
    if (clips.length === 0) {
      alert("Sube al menos un clip primero.");
      return;
    }

    setIsRendering(true);
    setOutputUrl(null);
    setJobId(null);

    try {
      const payload: any = {
        clips: clips
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((c) => ({
            url: c.url,
            name: c.name,
            startTime: c.startTime ?? 0,
            order: c.order,
          })),
        format,
        duration,
        style: { name: "dynamic", transitions: true, zoom: false, beatSync: false },
        overlays: [],
      };

      if (music?.url) payload.music = { url: music.url, name: music.name };
      if (referenceVideo?.url) payload.referenceVideo = { url: referenceVideo.url, name: referenceVideo.name };

      const { jobId: newJobId } = await createRenderJob(payload);
      setJobId(newJobId);

      // Polling
      const start = Date.now();
      while (true) {
        const data = await pollJob(newJobId);

        if (data?.status === "done" || data?.status === "completed" || data?.outputUrl) {
          if (data?.outputUrl) setOutputUrl(data.outputUrl);
          break;
        }

        if (data?.status === "error" || data?.error) {
          throw new Error(data?.error || "Error en render");
        }

        // corte de seguridad 6 min
        if (Date.now() - start > 6 * 60 * 1000) {
          throw new Error("Timeout esperando el render");
        }

        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e: any) {
      alert(e?.message || "Error renderizando");
      console.error(e);
    } finally {
      setIsRendering(false);
    }
  }

  async function handleChatGeneratePlan(messages: { role: "user" | "assistant"; content: string }[]) {
    try {
      const res = await generatePlan(messages, chatContext);
      setPlan(res);
    } catch (e: any) {
      setPlan({
        success: false,
        message: e?.message || "Error generando plan",
      });
    }
  }

  function removeClip(index: number) {
    setClips((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((c, i) => ({ ...c, order: i }));
    });
  }

  return (
    <div className="min-h-screen w-full p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Preview */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="glass neon-border">
            <CardHeader>
              <CardTitle className="text-lg">Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!outputUrl ? (
                <div className="h-[320px] md:h-[420px] rounded-lg bg-secondary/40 flex items-center justify-center text-sm text-muted-foreground">
                  {isRendering ? "Renderizando..." : "Aún no hay vídeo renderizado"}
                </div>
              ) : (
                <video className="w-full rounded-lg bg-black" controls src={outputUrl} />
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleRender} disabled={isRendering || clips.length === 0}>
                  {isRendering ? "Renderizando..." : "Renderizar vídeo"}
                </Button>

                {outputUrl && (
                  <a href={outputUrl} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Descargar MP4</Button>
                  </a>
                )}
              </div>

              {jobId && (
                <p className="text-xs text-muted-foreground">
                  Job: <span className="font-mono">{jobId}</span>
                </p>
              )}
            </CardContent>
          </Card>

          <EditPlanViewer plan={plan} />
        </div>

        {/* Right: Inputs + Chat */}
        <div className="lg:col-span-5 space-y-4">
          {/* ✅ Store smoke test (solo para comprobar Zustand) */}
          <StoreSmokeTest />

          <Card className="glass neon-border">
            <CardHeader>
              <CardTitle className="text-lg">Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Clips */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Clips de vídeo</div>
                  <div className="text-xs text-muted-foreground">{clips.length} clip(s)</div>
                </div>

                <input
                  ref={clipInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadClips(e.target.files)}
                />

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => clipInputRef.current?.click()}
                  disabled={isUploadingClips}
                >
                  {isUploadingClips ? "Subiendo..." : "Subir clips (varios)"}
                </Button>

                {clips.length > 0 && (
                  <div className="space-y-2">
                    {clips
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((c, idx) => (
                        <div key={`${c.url}-${idx}`} className="flex items-center gap-2 bg-secondary/40 rounded-md p-2">
                          <div className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</div>
                          <div className="text-sm truncate flex-1">{c.name || c.url}</div>
                          <Button variant="ghost" onClick={() => removeClip(idx)}>
                            Quitar
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Music */}
              <div className="space-y-2">
                <div className="font-medium">Música (opcional)</div>
                <input
                  ref={musicInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => handleUploadMusic(e.target.files?.[0] || null)}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => musicInputRef.current?.click()}
                  disabled={isUploadingMusic}
                >
                  {isUploadingMusic ? "Subiendo..." : music ? "Cambiar música" : "Subir música"}
                </Button>
                {music?.url && <p className="text-xs text-muted-foreground truncate">{music.name || music.url}</p>}
              </div>

              {/* Reference Video */}
              <div className="space-y-2">
                <div className="font-medium">Vídeo de referencia (opcional)</div>
                <input
                  ref={refInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleUploadReference(e.target.files?.[0] || null)}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => refInputRef.current?.click()}
                  disabled={isUploadingRef}
                >
                  {isUploadingRef ? "Subiendo..." : referenceVideo ? "Cambiar referencia" : "Subir vídeo de referencia"}
                </Button>
                {referenceVideo?.url && (
                  <p className="text-xs text-muted-foreground truncate">{referenceVideo.name || referenceVideo.url}</p>
                )}
              </div>

              {/* Format / Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Plataforma</div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={format === "tiktok" ? "default" : "secondary"}
                      onClick={() => setFormat("tiktok")}
                      className="flex-1"
                    >
                      TikTok
                    </Button>
                    <Button
                      type="button"
                      variant={format === "reels" ? "default" : "secondary"}
                      onClick={() => setFormat("reels")}
                      className="flex-1"
                    >
                      Reels
                    </Button>
                    <Button
                      type="button"
                      variant={format === "youtube" ? "default" : "secondary"}
                      onClick={() => setFormat("youtube")}
                      className="flex-1"
                    >
                      YouTube
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Duración (s)</div>
                  <Input value={duration} type="number" min={5} max={300} onChange={(e) => setDuration(Number(e.target.value || 30))} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chat */}
          <ChatPanel
            context={chatContext}
            onPlan={(newPlan: any) => {
              if (newPlan?.success !== undefined) {
                setPlan(newPlan);
              } else {
                setPlan({ success: true, message: "Plan generado", plan: newPlan });
              }
            }}
            onGeneratePlanFromChat={handleChatGeneratePlan as any}
          />
        </div>
      </div>
    </div>
  );
}
