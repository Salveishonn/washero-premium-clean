import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  OPERATOR_PROOF_ACCEPT,
  formatOperationClock,
  formatProofBytes,
  isHeicLikeProof,
  type OperatorCompletionProofSummary,
} from "@/lib/operator-lifecycle";

type Props = {
  open: boolean;
  bookingId: string;
  existingProof?: OperatorCompletionProofSummary | null;
  selectedFile: File | null;
  previewUrl: string | null;
  error?: string | null;
  uploading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (file: File) => void;
  onClearFile: () => void;
  onUpload: () => void;
};

export function OperatorCompletionProof({
  open,
  bookingId,
  existingProof,
  selectedFile,
  previewUrl,
  error,
  uploading = false,
  onOpenChange,
  onSelectFile,
  onClearFile,
  onUpload,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [selectedFile, previewUrl]);

  const heicFallback = selectedFile ? isHeicLikeProof(selectedFile) : false;
  const showImage = !!previewUrl && !heicFallback && !previewFailed;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (uploading && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Foto del vehículo terminado</AlertDialogTitle>
          <AlertDialogDescription>
            La foto queda privada. Sacá o elegí una imagen clara del lavado finalizado.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {existingProof && !selectedFile ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            ✓ Foto de finalización cargada
            {formatOperationClock(existingProof.created_at)
              ? ` · Subida ${formatOperationClock(existingProof.created_at)}`
              : ""}
          </p>
        ) : null}

        {selectedFile ? (
          <div className="space-y-2">
            {showImage ? (
              <img
                src={previewUrl ?? ""}
                alt="Vista previa de la foto de finalización"
                className="max-h-56 w-full rounded-md object-cover"
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <div className="rounded-md border bg-muted/40 px-3 py-6 text-center text-sm">
                <p className="font-medium">Foto seleccionada</p>
                <p className="mt-1 text-muted-foreground">
                  {heicFallback ? "HEIC" : selectedFile.type || "imagen"}
                  {selectedFile.size ? ` · ${formatProofBytes(selectedFile.size)}` : ""}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <input
          ref={cameraRef}
          type="file"
          accept={OPERATOR_PROOF_ACCEPT}
          capture="environment"
          className="hidden"
          data-booking-id={bookingId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onSelectFile(file);
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept={OPERATOR_PROOF_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onSelectFile(file);
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="mr-2 h-4 w-4" />
            Sacar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={uploading}
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus className="mr-2 h-4 w-4" />
            Elegir foto
          </Button>
        </div>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {selectedFile ? (
            <>
              <Button type="button" className="w-full" disabled={uploading} onClick={onUpload}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {uploading ? "Subiendo foto..." : "Usar esta foto"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={uploading}
                onClick={onClearFile}
              >
                Repetir
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
