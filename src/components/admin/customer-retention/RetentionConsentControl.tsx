import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveRetentionPreference } from "@/lib/admin-customer-communication-preferences";
import type { CustomerCommunicationPreference } from "@/lib/admin-customer-communication-preferences";
import {
  PreferenceEvidenceError,
  formatPreferenceRecordedAt,
  retentionConsentLabel,
  retentionQueueConsentLabel,
  type MarketingConsentStatus,
} from "@/lib/customer-communication-preferences";
import {
  RetentionConsentDialog,
  type RetentionConsentAction,
} from "@/components/admin/customer-retention/RetentionConsentDialog";

const DUPLICATE_PHONE_WARNING =
  "Este teléfono está asociado a más de un cliente. El envío de seguimiento permanecerá bloqueado hasta resolver la identidad.";

function recordedAt(preference: CustomerCommunicationPreference | null | undefined): string | null {
  if (!preference) return null;
  return formatPreferenceRecordedAt(
    preference.status === "opted_out" ? preference.opted_out_at : preference.opted_in_at,
  );
}

export function RetentionConsentControl({
  variant,
  customerId,
  customerName,
  status,
  preference,
  duplicatePhone,
  ready = true,
  onSaved,
}: {
  variant: "card" | "compact";
  customerId: string;
  customerName: string;
  status: MarketingConsentStatus;
  preference?: CustomerCommunicationPreference | null;
  duplicatePhone: boolean;
  ready?: boolean;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<RetentionConsentAction | null>(null);
  const save = useMutation({
    mutationFn: (evidenceNote: string) => {
      if (!action) throw new Error("missing_action");
      return saveRetentionPreference({
        customerId,
        action,
        evidenceNote,
        existingOptedInAt: preference?.opted_in_at,
      });
    },
    onSuccess: async () => {
      setAction(null);
      await qc.invalidateQueries({ queryKey: ["admin", "customer-communication-preference"] });
      onSaved?.();
      toast.success("Preferencia de WhatsApp guardada.");
    },
    onError: (error: Error) => {
      if (error instanceof PreferenceEvidenceError) {
        toast.error("La nota de evidencia es obligatoria.");
        return;
      }
      toast.error("No se pudo guardar la preferencia.");
    },
  });

  const when = recordedAt(preference);
  const actions = (
    <div className="flex flex-wrap gap-2">
      {status !== "opted_in" && (
        <Button type="button" size="sm" className="min-h-11" onClick={() => setAction("opt_in")}>
          {status === "opted_out" ? "Registrar nuevo consentimiento" : "Registrar consentimiento"}
        </Button>
      )}
      {status !== "opted_out" && (
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setAction("opt_out")}>
          Registrar que no desea recibir mensajes
        </Button>
      )}
    </div>
  );

  const dialog = (
    <RetentionConsentDialog
      open={action !== null}
      action={action ?? "opt_in"}
      customerName={customerName}
      currentStatus={status}
      pending={save.isPending}
      onOpenChange={(open) => {
        if (!open) setAction(null);
      }}
      onSubmit={(evidenceNote) => save.mutate(evidenceNote)}
    />
  );

  if (variant === "compact") {
    return (
      <div className="min-w-0 space-y-1" onClick={(event) => event.stopPropagation()}>
        <div className="text-xs text-muted-foreground">
          {ready ? retentionQueueConsentLabel(status) : "Preferencia…"}
        </div>
        {duplicatePhone && (
          <p className="max-w-xs text-xs text-muted-foreground">{DUPLICATE_PHONE_WARNING}</p>
        )}
        {ready && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Registrar preferencia</summary>
            <div className="pt-2">{actions}</div>
          </details>
        )}
        {dialog}
      </div>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Preferencias de comunicación</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm">WhatsApp · Próximos lavados</p>
          <p className="text-sm text-muted-foreground">
            {ready ? retentionConsentLabel(status) : "Cargando preferencia…"}
          </p>
          {when && <p className="text-xs text-muted-foreground">Registrado por admin · {when}</p>}
        </div>
        {duplicatePhone && <p className="text-sm text-muted-foreground">{DUPLICATE_PHONE_WARNING}</p>}
        {ready && actions}
        {dialog}
      </CardContent>
    </Card>
  );
}
