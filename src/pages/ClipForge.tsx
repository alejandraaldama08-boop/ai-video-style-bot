import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditPlanViewer } from "@/components/EditPlanViewer";
import { useEditPlanGenerator } from "@/hooks/useEditPlanGenerator";
import { 
  Sparkles, 
  Loader2, 
  Video, 
  Music, 
  FileVideo,
  Zap
} from "lucide-react";

export default function ClipForge() {
  const { generatePlan, isGenerating, editPlan, error } = useEditPlanGenerator();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <header className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/10 via-transparent to-neon-cyan/10" />
        <div className="container mx-auto px-4 py-12 relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-gradient-to-br from-neon-purple to-neon-cyan">
              <Zap className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold gradient-text">ClipForge</h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl">
            Editor de video con IA. Genera planes de edición profesionales 
            estilo CapCut/football edit con beat drops automáticos.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Column - Controls */}
          <div className="space-y-6">
            {/* Upload Section */}
            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5 text-neon-purple" />
                  Archivos del Proyecto
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Clips */}
                <div className="p-4 border border-dashed border-border rounded-lg hover:border-neon-purple/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <FileVideo className="h-5 w-5" />
                    <div>
                      <p className="font-medium text-foreground">Clips de video</p>
                      <p className="text-sm">Arrastra o haz clic para subir</p>
                    </div>
                  </div>
                </div>

                {/* Music */}
                <div className="p-4 border border-dashed border-border rounded-lg hover:border-neon-cyan/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Music className="h-5 w-5" />
                    <div>
                      <p className="font-medium text-foreground">Música (opcional)</p>
                      <p className="text-sm">MP3 o WAV</p>
                    </div>
                  </div>
                </div>

                {/* Reference */}
                <div className="p-4 border border-dashed border-border rounded-lg hover:border-neon-pink/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Sparkles className="h-5 w-5" />
                    <div>
                      <p className="font-medium text-foreground">Video de referencia (opcional)</p>
                      <p className="text-sm">Estilo a copiar</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generate Button */}
            <Card className="glass neon-border">
              <CardContent className="pt-6">
                <Button
                  onClick={generatePlan}
                  disabled={isGenerating}
                  variant="neon"
                  size="lg"
                  className="w-full text-lg h-14"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      Generar Plan
                    </>
                  )}
                </Button>

                {error && (
                  <p className="mt-4 text-sm text-destructive text-center">
                    {error}
                  </p>
                )}

                <p className="mt-4 text-xs text-center text-muted-foreground">
                  Conectado a: ai-video-style-bot-jom9.vercel.app
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Plan Viewer */}
          <div>
            <EditPlanViewer plan={editPlan} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            ClipForge • Editor de video con IA
          </p>
        </div>
      </footer>
    </div>
  );
}
