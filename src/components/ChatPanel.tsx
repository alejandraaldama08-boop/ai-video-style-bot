import { useEffect, useMemo, useRef, useState } from "react";
import { generatePlanFromChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Role = "system" | "user" | "assistant";

export type ChatMessage = {
  role: Role;
  content: string;
};

type ChatContext = {
  clips?: Array<{ url: string; name?: string; order?: number }>;
  format?: string;
  duration?: number;
  referenceVideo?: { url: string; name?: string } | null;
  music?: { url: string; name?: string } | null;
  [key: string]: unknown;
};

export function ChatPanel({
  context,
  onPlan,
}: {
  context: ChatContext;
  onPlan: (planResponse: any) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      role: "system",
      content:
        "Pega aquí el estilo, referencias y lo que quieres. Luego envía y generaré un plan.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function handleSend() {
    if (!canSend) return;

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await generatePlanFromChat(
        [...messages, userMsg].filter((m) => m.role !== "system"),
        context
      );

      onPlan(res);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Plan generado ✅. Revísalo en el panel “Plan de Edición”. Dime qué cambiar y lo ajusto.",
        },
      ]);
    } catch (e: any) {
      setError(e?.message || "Error generando el plan");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Error generando el plan. Comprueba que tu backend tiene POST /plan y que VITE_API_URL está bien.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="glass neon-border h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">Chat IA</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto rounded-lg bg-background/40 p-3 space-y-2 min-h-0"
        >
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-primary/20 p-2 text-sm"
                  : m.role === "assistant"
                  ? "mr-auto max-w-[85%] rounded-lg bg-secondary/50 p-2 text-sm"
                  : "mr-auto max-w-[85%] rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground"
              }
            >
              {m.content}
            </div>
          ))}

          {loading && (
            <div className="mr-auto max-w-[85%] rounded-lg bg-secondary/50 p-2 text-sm">
              Generando plan…
            </div>
          )}
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe el edit (estilo, ritmo, zooms, beat sync, textos...)"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <Button onClick={handleSend} disabled={!canSend}>
            Enviar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
