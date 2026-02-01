import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

export default function InputsPanel() {
  return (
    <div className="flex flex-col gap-4 p-4 text-white">
      
      <div className="rounded-lg border border-white/10 p-3">
        <h3 className="mb-2 font-semibold">Clips de vídeo</h3>
        <Button variant="secondary" className="w-full border-dashed border-2">
          <Upload className="w-4 h-4 mr-2" />
          Subir clips
        </Button>
      </div>

      <div className="rounded-lg border border-white/10 p-3">
        <h3 className="mb-2 font-semibold">Música</h3>
        <Button variant="secondary" className="w-full border-dashed border-2">
          <Upload className="w-4 h-4 mr-2" />
          Subir audio
        </Button>
      </div>

      <div className="rounded-lg border border-white/10 p-3">
        <h3 className="mb-2 font-semibold">Vídeo de referencia</h3>
        <Button variant="secondary" className="w-full border-dashed border-2">
          <Upload className="w-4 h-4 mr-2" />
          Subir referencia
        </Button>
      </div>

    </div>
  );
}
