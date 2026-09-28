import { useState } from "react";
import { Camera, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  COMPLETED_WITHOUT_PROOF_COPY,
  completionProofLabel,
  formatAdminDateTime,
  isHeicProofMime,
  proofKindLabel,
  type CompletionProofSignal,
} from "@/lib/admin-booking-detail";
import type { AdminProofPublicItem } from "@/lib/admin-booking-proofs-logic";
import { formatProofBytes } from "@/lib/operator-lifecycle";

export function BookingProofGallery({
  proofs,
  signal,
  loading,
  error,
  onRetry,
}: {
  proofs: AdminProofPublicItem[];
  signal: CompletionProofSignal;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = proofs.find((p) => p.id === openId) ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Pruebas</CardTitle>
          <Badge variant={signal === "missing" || signal === "completed_without_proof" ? "destructive" : "secondary"}>
            {completionProofLabel(signal)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {signal === "completed_without_proof" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            {COMPLETED_WITHOUT_PROOF_COPY}
          </p>
        )}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="aspect-square w-full" />
          </div>
        ) : error ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">No pudimos cargar las pruebas.</p>
            {onRetry && (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Reintentar
              </Button>
            )}
          </div>
        ) : proofs.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Camera className="h-4 w-4" />
            No hay fotos de prueba para esta reserva.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {proofs.map((proof) => (
              <ProofCard key={proof.id} proof={proof} onOpen={() => setOpenId(proof.id)} />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {proofKindLabel(open.proof_kind)} · {formatAdminDateTime(open.created_at)}
                </DialogTitle>
              </DialogHeader>
              {open.preview_error || !open.signed_url ? (
                <p className="text-sm text-muted-foreground">No pudimos generar la vista previa.</p>
              ) : isHeicProofMime(open.mime_type) ? (
                <HeicFallback signedUrl={open.signed_url} />
              ) : (
                <img
                  src={open.signed_url}
                  alt={proofKindLabel(open.proof_kind)}
                  className="max-h-[70vh] w-full rounded-md object-contain"
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProofCard({ proof, onOpen }: { proof: AdminProofPublicItem; onOpen: () => void }) {
  const heic = isHeicProofMime(proof.mime_type);
  const failed = proof.preview_error || !proof.signed_url;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="overflow-hidden rounded-lg border bg-muted/30 text-left"
    >
      <div className="aspect-square bg-muted">
        {failed ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            No se pudo generar la vista previa
          </div>
        ) : heic ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
            <p className="text-sm font-medium">Archivo HEIC</p>
            <p className="text-xs text-muted-foreground">Abrir archivo</p>
          </div>
        ) : (
          <img src={proof.signed_url!} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="text-xs font-medium">{proofKindLabel(proof.proof_kind)}</p>
        <p className="text-[11px] text-muted-foreground">{formatAdminDateTime(proof.created_at)}</p>
        <p className="truncate text-[11px] text-muted-foreground">{proof.uploader_email ?? "Operador"}</p>
        <p className="text-[11px] text-muted-foreground">
          {proof.mime_type}
          {proof.size_bytes ? ` · ${formatProofBytes(proof.size_bytes)}` : ""}
        </p>
      </div>
    </button>
  );
}

function HeicFallback({ signedUrl }: { signedUrl: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm font-medium">Archivo HEIC</p>
      <p className="text-sm text-muted-foreground">Este formato puede no previsualizarse en el navegador.</p>
      <Button asChild variant="outline">
        <a href={signedUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="mr-1 h-4 w-4" /> Abrir archivo
        </a>
      </Button>
    </div>
  );
}
