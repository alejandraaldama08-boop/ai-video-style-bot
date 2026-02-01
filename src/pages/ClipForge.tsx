import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ChatPanel } from "@/components/ChatPanel";
import { EditPlanViewer } from "@/components/EditPlanViewer";
import StoreSmokeTest from "@/components/StoreSmokeTest";

type UploadedFile = { url: string; name?: string; mimetype?: string; size?: number };
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

// ✅ Importante: forzamos HTTPS para evitar mixed content
const API_URL = "https://ai-video-style-bot-3.onrender.com";

// ---------- helpers ----------
async function readJsonSafe(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function uploadOne(file: File): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: fd,
  });

  const { json, text } = await readJsonSafe(res);

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `Upload failed (${res.status})`;
    throw new Error(msg);
  }

  if (!json?.url) throw new Error("Upload response missing url");

  return {
    url: json.url,
    name: json.name || file.name,
    mimetype: json.mimetype,
    size: json.size,
  };
}

// ✅ Render directo (sin job/poll)
async function renderNow(payload: any): Promise<{ outputUrl: string; raw: any }> {
  const res = await fetch(`${API_URL}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const { json, text } = await readJsonSafe(res);

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `Render failed (${res.status})`;
    throw new Error(msg);
  }

  const out = json?.outputUrl || json?.url || json?.videoUrl;
  if (!out) throw new Error("Render OK pero no devuelve URL (outputUrl/url/videoUrl)");

  return { outputUrl: out, raw: json };
}

async function generatePlan(messages: { role: "user" | "assistant"; content: string }[], context: any) {
  const res = await fetch(`${API_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });

  const { json, text } = await readJsonSafe(res);

  if (!res.ok) {
    const msg = json?.error || text || `Plan failed (${res.status})`;
    throw new Error(msg);
  }

  if (json?.plan) {
    return { success: true, message: "Plan generado correctamente", plan: json.plan };
  }

  if (typeof json?.success === "boolean") return json as any;

  return { success: true, message: "Plan generado", plan: json };
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

  // Upload states
  const [isUploadingClips, setIsUploadingClips] = useState(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  // Render states
  const [isRendering, setIsRendering] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Debug UI
  const [debugMsg, setDebugMsg] = useState<string>("");
  const [lastRenderResponse, setLastRenderResponse] = useState<any>(null);

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
    setDebugMsg("");
    setIsUploadingClips(true);

    try {
      const uploaded: ClipItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const up = await uploadOne(f);
        uploaded.push({ url: up.url, name: up.name, order: i, startTime: 0 });
      }

      setClips((prev) => {
        const base = prev.slice();
        const startOrder = base.length;
        return base.concat(uploaded.map((c, idx) => ({ ...c, order: startOrder + idx })));
      });
    } catch (e: any) {
      setDebugMsg(`❌ Subida clips: ${e?.message || "Error subiendo clips"}`);
      alert(e?.message || "Error subiendo clips");
      console.error(e);
    } finally {
      setIsUploadingClips(false);
      if (clipInputRef.current) clipInputRef.current.value = "";
    }
  }

  async function handleUploadMusic(file: File | null) {
    if (!file) return;
    setDebugMsg("");
    setIsUploadingMusic(true);

    try {
      setDebugMsg(
        `🎵 Intentando subir música: ${file.name} (${file.type || "sin mimetype"}, ${(file.size / 1024 / 1024).toFixed(
          2
        )} MB)`
      );

      const up = await uploadOne(file);
      setMusic(up);

      setDebugMsg(
        `✅ Música subida: ${up.name} | mimetype=${up.mimetype || "?"} | size=${
          up.size ? (up.size / 1024 / 1024).toFixed(2) + "MB" : "?"
        }`
      );
    } catch (e: any) {
      setDebugMsg(`❌ Subida música: ${e?.message || "Error subiendo música"}`);
      alert(e?.message || "Error subiendo música");
      console.error(e);
    } finally {
      setIsUploadingMusic(false);
      if (musicInputRef.current) musicInputRef.current.value = "";
    }
  }

  async function handleUploadReference(file: File | null) {
    if (!file) return;
    setDebugMsg("");
    setIsUploadingRef(true);

    try {
      const up = await uploadOne(file);
      setReferenceVideo(up);
      setDebugMsg(`✅ Referencia subida: ${up.name || up.url}`);
    } catch (e: any) {
      setDebugMsg(`❌ Subida referencia: ${e?.message || "Error subiendo referencia"}`);
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

    setDebugMsg("");
    setIsRendering(true);
    setOutputUrl(null);
    setLastRenderResponse(null);

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

      setDebugMsg(`🎬 Enviando render payload...\n${JSON.stringify(payload, null, 2).slice(0, 1200)}`);

      const { outputUrl: out, raw } = await renderNow(payload);
      setLastRenderResponse(raw);
      setOutputUrl(out);

      setDebugMsg(`✅ Render OK!\nSalida: ${out}`);
    } catch (e: any) {
      setDebugMsg(`❌ Render: ${e?.message || "Error renderizando"}`);
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
      setPlan({ success: false, message: e?.message || "Error generando plan" });
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
                <div className="h-[320px] md:h-[420px] rounded-lg bg-secondary/40 flex flex-col gap-2 items-center justify-center text-sm text-muted-foreground">
                  <div>{isRendering ? "Renderizando..." : "Aún no hay vídeo renderizado"}</div>
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
            </CardContent>
          </Card>

          <EditPlanViewer plan={plan} />
        </div>

        {/* Right: Inputs + Chat */}
        <div className="lg:col-span-5 space-y-4">
          <StoreSmokeTest />

          {/* Debug card */}
          <Card className="glass neon-border">
            <CardHeader>
              <CardTitle className="text-lg">Debug</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs text-muted-foreground">
                API_URL: <span className="font-mono">{API_URL}</span>
              </div>

              {debugMsg && (
                <pre className="text-xs whitespace-pre-wrap rounded-md bg-secondary/40 p-2">{debugMsg}</pre>
              )}

              {lastRenderResponse && (
                <pre className="text-xs whitespace-pre-wrap rounded-md bg-secondary/40 p-2">
                  {JSON.stringify(lastRenderResponse, null, 2).slice(0, 1500)}
                </pre>
              )}
            </CardContent>
          </Card>

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
                  // ✅ acepta MP3 seguro
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
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

                {music?.url && (
                  <p className="text-xs text-muted-foreground truncate">
                    {music.name || music.url} {music.mimetype ? `(${music.mimetype})` : ""}
                  </p>
                )}
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
                  <p className="text-xs text-muted-foreground truncate">
                    {referenceVideo.name || referenceVideo.url}
                  </p>
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
                  <Input
                    value={duration}
                    type="number"
                    min={5}
                    max={300}
                    onChange={(e) => setDuration(Number(e.target.value || 30))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chat */}
          <ChatPanel
            context={chatContext}
            onPlan={(newPlan: any) => {
              if (newPlan?.success !== undefined) setPlan(newPlan);
              else setPlan({ success: true, message: "Plan generado", plan: newPlan });
            }}
            onGeneratePlanFromChat={handleChatGeneratePlan as any}
          />
        </div>
      </div>
    </div>
  );
}
