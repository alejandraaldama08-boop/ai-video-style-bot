import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileJson, CheckCircle, Clock, Sparkles } from "lucide-react";

interface EditPlanViewerProps {
  plan: {
    success: boolean;
    message: string;
    plan?: {
      steps?: unknown[];
      timeline?: unknown[];
      [key: string]: unknown;
    };
  } | null;
}

export function EditPlanViewer({ plan }: EditPlanViewerProps) {
  if (!plan) {
    return (
      <Card className="glass neon-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileJson className="h-5 w-5 text-neon-cyan" />
            Plan de Edición
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Sparkles className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center">
              Pulsa "Generar Plan" para crear tu plan de edición con IA
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass neon-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileJson className="h-5 w-5 text-neon-cyan" />
          Plan de Edición
          {plan.success && (
            <CheckCircle className="h-4 w-4 text-green-500 ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Estado:</span>
          <span
            className={
              plan.success
                ? "text-green-400 font-medium"
                : "text-destructive font-medium"
            }
          >
            {plan.success ? "Generado correctamente" : "Error"}
          </span>
        </div>

        {/* Message */}
        <div className="flex items-start gap-2 text-sm">
          <span className="text-muted-foreground">Mensaje:</span>
          <span className="text-foreground">{plan.message}</span>
        </div>

        {/* Plan Details */}
        {plan.plan && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Detalles del Plan
            </h4>

            {/* Steps */}
            {plan.plan.steps && Array.isArray(plan.plan.steps) && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Steps ({plan.plan.steps.length})
                </p>
                {plan.plan.steps.length > 0 ? (
                  <div className="space-y-2">
                    {plan.plan.steps.map((step, index) => (
                      <div
                        key={index}
                        className="text-sm bg-background/50 rounded p-2"
                      >
                        {typeof step === "object"
                          ? JSON.stringify(step, null, 2)
                          : String(step)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Sin pasos definidos
                  </p>
                )}
              </div>
            )}

            {/* Timeline */}
            {plan.plan.timeline && Array.isArray(plan.plan.timeline) && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Timeline ({plan.plan.timeline.length})
                </p>
                {plan.plan.timeline.length > 0 ? (
                  <div className="space-y-2">
                    {plan.plan.timeline.map((item, index) => (
                      <div
                        key={index}
                        className="text-sm bg-background/50 rounded p-2"
                      >
                        {typeof item === "object"
                          ? JSON.stringify(item, null, 2)
                          : String(item)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Timeline vacío
                  </p>
                )}
              </div>
            )}

            {/* Raw JSON */}
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                Ver JSON completo
              </summary>
              <pre className="mt-2 bg-background/80 rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono">
                {JSON.stringify(plan, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
