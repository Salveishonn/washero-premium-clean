import { supabase } from "@/integrations/supabase/client";

export type DeleteBookingResult =
  | { ok: true }
  | { ok: false; error: string; error_code?: string };

const FINANCIAL_EVIDENCE_MESSAGE =
  "Esta reserva tiene información financiera asociada (comprobante aprobado, pago o factura) y no puede eliminarse definitivamente.";

const CUSTOMER_FINANCIAL_EVIDENCE_MESSAGE =
  "No se puede eliminar el cliente junto con todas sus reservas porque al menos una tiene información financiera que debe conservarse.";

const HARD_DELETE_MESSAGES: Record<string, string> = {
  invalid_request: "Reserva inválida.",
  unauthorized: "Tenés que iniciar sesión para eliminar una reserva.",
  forbidden: "No tenés permiso para eliminar reservas.",
  proof_path_invalid: "Hay archivos de prueba con una ruta inválida. No eliminamos la reserva.",
  storage_list_failed: "No pudimos limpiar las fotos de prueba. Reintentá.",
  storage_delete_failed: "No pudimos limpiar las fotos de prueba. Reintentá.",
  storage_cleanup_incomplete: "No pudimos limpiar las fotos de prueba. Reintentá.",
  too_many_objects: "No pudimos limpiar las fotos de prueba. Reintentá.",
  financial_evidence_exists: FINANCIAL_EVIDENCE_MESSAGE,
  financial_lookup_failed: "No pudimos verificar la información financiera de la reserva. Reintentá.",
  payment_receipt_path_invalid: "Hay un comprobante de pago con una ruta inválida. No eliminamos la reserva.",
  payment_receipt_storage_conflict:
    "Hay un comprobante de pago que no podemos limpiar de forma segura. No eliminamos la reserva.",
  payment_receipt_storage_list_failed: "No pudimos limpiar los comprobantes de pago. Reintentá.",
  payment_receipt_storage_delete_failed: "No pudimos limpiar los comprobantes de pago. Reintentá.",
  payment_receipt_storage_cleanup_incomplete: "No pudimos limpiar los comprobantes de pago. Reintentá.",
  payment_receipt_too_many_objects: "No pudimos limpiar los comprobantes de pago. Reintentá.",
  payment_receipt_delete_failed:
    "Los archivos de comprobante se limpiaron, pero no pudimos eliminar los registros. Reintentá.",
  invoice_delete_failed: "No pudimos eliminar la factura asociada.",
  booking_delete_failed: "Las fotos se limpiaron, pero la reserva no se eliminó. Reintentá.",
  verification_failed: "No pudimos confirmar la eliminación. Reintentá.",
};

function publicDeleteMessage(code: string | undefined, fallback?: string): string {
  if (code && HARD_DELETE_MESSAGES[code]) return HARD_DELETE_MESSAGES[code];
  if (fallback?.trim()) return fallback;
  return "No pudimos eliminar la reserva.";
}

async function messageFromFunctionsError(error: { message: string; context?: Response }): Promise<{
  error: string;
  error_code?: string;
}> {
  const fallback = error.message || "No pudimos eliminar la reserva.";
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.clone().json()) as {
        message?: string;
        error?: string;
      };
      const code = typeof body?.error === "string" ? body.error : undefined;
      if (typeof body?.message === "string" && body.message.trim()) {
        return { error: publicDeleteMessage(code, body.message), error_code: code };
      }
      if (code) return { error: publicDeleteMessage(code), error_code: code };
    }
  } catch {
    // keep fallback
  }
  if (/failed to send a request to the edge function/i.test(fallback)) {
    return { error: "No pudimos contactar el servidor. Probá de nuevo en unos segundos." };
  }
  return { error: fallback };
}

function failResult(code: string | undefined, fallback?: string): DeleteBookingResult {
  return { ok: false, error: publicDeleteMessage(code, fallback), error_code: code };
}

/** Hard-delete a booking through the canonical admin-delete-booking Edge Function. */
export async function deleteBooking(bookingId: string): Promise<DeleteBookingResult> {
  const id = bookingId.trim();
  if (!id) return { ok: false, error: "Reserva inválida." };

  const { data, error } = await supabase.functions.invoke("admin-delete-booking", {
    body: { booking_id: id },
  });
  if (error) {
    const mapped = await messageFromFunctionsError(error);
    return { ok: false, ...mapped };
  }

  if (data && typeof data === "object") {
    const row = data as { ok?: unknown; message?: unknown; error?: unknown };
    if (row.ok === false) {
      const message = typeof row.message === "string" ? row.message : undefined;
      const code = typeof row.error === "string" ? row.error : undefined;
      return failResult(code, message);
    }
  }

  return { ok: true };
}

export async function deleteBookings(bookingIds: string[]): Promise<DeleteBookingResult> {
  for (const id of bookingIds) {
    const res = await deleteBooking(id);
    if (!res.ok) return res;
  }
  return { ok: true };
}

export async function deleteCustomer(opts: {
  customerId: string;
  deleteBookingsToo: boolean;
  bookingIds?: string[];
}): Promise<DeleteBookingResult> {
  if (opts.deleteBookingsToo && opts.bookingIds?.length) {
    const res = await deleteBookings(opts.bookingIds);
    if (!res.ok) {
      if (res.error_code === "financial_evidence_exists") {
        return {
          ok: false,
          error: CUSTOMER_FINANCIAL_EVIDENCE_MESSAGE,
          error_code: "financial_evidence_exists",
        };
      }
      return res;
    }
  }

  const { error } = await supabase.from("customers").delete().eq("id", opts.customerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
