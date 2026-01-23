import { useState } from "react";
import { toast } from "@/hooks/use-toast";

interface EditPlan {
  success: boolean;
  message: string;
  plan?: {
    steps?: unknown[];
    timeline?: unknown[];
    [key: string]: unknown;
  };
}

const VERCEL_ENDPOINT = "https://ai-video-style-bot-jom9.vercel.app/api/generate";

export function useEditPlanGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [editPlan, setEditPlan] = useState<EditPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generatePlan = async () => {
    setIsGenerating(true);
    setError(null);
    setEditPlan(null);

    try {
      const response = await fetch(VERCEL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt:
            "Genera un plan de edición estilo CapCut/football edit con beat drops. Devuelve un JSON con clips, timestamps, efectos, textos, transiciones y recomendaciones.",
        }),
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data: EditPlan = await response.json();
      setEditPlan(data);

      toast({
        title: "¡Plan generado!",
        description: data.message || "El plan de edición está listo.",
      });

      return data;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Error desconocido";
      setError(errorMessage);

      toast({
        title: "Error al generar",
        description: errorMessage,
        variant: "destructive",
      });

      throw err;
    } finally {
      setIsGenerating(false);
    }
  };

  const clearPlan = () => {
    setEditPlan(null);
    setError(null);
  };

  return {
    generatePlan,
    clearPlan,
    isGenerating,
    editPlan,
    error,
  };
}
