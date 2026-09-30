import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeEvidenceNote,
  retentionConsentLabel,
  type MarketingConsentStatus,
} from "@/lib/customer-communication-preferences";

export type RetentionConsentAction = "opt_in" | "opt_out";

const CONFIRMATION: Record<RetentionConsentAction, string> = {
  opt_in:
    "Confirmo que el cliente aceptó recibir mensajes de WhatsApp de Washero para ofrecer próximos lavados.",
  opt_out:
    "Confirmo que el cliente pidió no recibir mensajes de WhatsApp de Washero para ofrecer próximos lavados.",
};

export function RetentionConsentDialog({
  open,
  action,
  customerName,
  currentStatus,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  action: RetentionConsentAction;
  customerName: string;
  currentStatus: MarketingConsentStatus;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (evidenceNote: string) => void;
}) {
  const [note, setNote] = useState("");
  const evidence = normalizeEvidenceNote(note);
  const title = action === "opt_in" ? "Registrar consentimiento" : "Registrar que no desea recibir mensajes";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {customerName}. Estado actual: {retentionConsentLabel(currentStatus)}. Esto no envía un WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!evidence || pending) return;
            onSubmit(evidence);
          }}
        >
          <p className="text-sm text-muted-foreground">{CONFIRMATION[action]}</p>
          <div className="space-y-1.5">
            <Label htmlFor="retention-evidence">Nota de evidencia</Label>
            <Textarea
              id="retention-evidence"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              required
              className="min-h-24 text-base sm:text-sm"
              placeholder="Qué dijo el cliente y por qué canal."
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={!evidence || pending}>
              Guardar preferencia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
