// Helpers for create-admin-booking edge function.
// deno-lint-ignore-file no-explicit-any

import type { CoreResult } from "./booking-core.ts";

export const ADMIN_PAYMENT_METHODS = ["MercadoPago", "Transferencia", "Pagar después"] as const;

export function normalizePaymentMethod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t === "mercadopago" || t === "mercado pago") return "MercadoPago";
  if (t === "transferencia") return "Transferencia";
  if (t === "pagar despues" || t === "efectivo" || t === "pagar después") return "Pagar después";
  if ((ADMIN_PAYMENT_METHODS as readonly string[]).includes(raw.trim())) return raw.trim();
  return null;
}

export function normalizeVehicleType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t === "suv") return "SUV";
  if (t.includes("pick") || t.includes("camioneta") || t.includes("van")) return "Pick-up";
  if (t === "moto" || t === "otro") return "Otro";
  if (t === "auto") return "Auto";
  if (["Auto", "SUV", "Pick-up", "Otro"].includes(raw.trim())) return raw.trim();
  return null;
}

const REASON_MESSAGES: Record<string, string> = {
  missing_fields: "Faltan datos para crear la reserva.",
  invalid_phone: "Ingresá un celular argentino válido, por ejemplo +54 9 11 1234-5678.",
  invalid_service: "El servicio seleccionado no está disponible.",
  invalid_vehicle: "Tipo de vehículo inválido. Usá Auto, SUV, Pick-up u Otro.",
  invalid_payment: "Método de pago inválido.",
  invalid_date: "Fecha inválida.",
  invalid_time: "Horario inválido.",
  past_date: "La fecha debe ser hoy o posterior.",
  invalid_extra: "Hay un extra inválido.",
  slot_unavailable: "Ese horario ya no está disponible.",
  slot_not_found: "Ese horario no está disponible en el calendario.",
  service_does_not_fit_slot: "El servicio no entra en el horario seleccionado.",
  slot_full: "Ese horario ya se completó (capacidad agotada).",
  duplicate: "Ya existe una reserva para ese teléfono en ese día y horario.",
  outside_coverage: "La dirección está fuera de la zona de cobertura.",
  invalid_private_neighborhood: "El barrio privado seleccionado no está disponible.",
  too_many_units: "Solo se permiten hasta 2 vehículos por turno en la web.",
  server_error: "No pudimos crear la reserva.",
};

export function coreFailureResponse(result: Extract<CoreResult, { ok: false }>) {
  return {
    ok: false as const,
    status: result.reason,
    customer_message: REASON_MESSAGES[result.reason] ?? result.message,
    missing: result.reason === "missing_fields" ? result.missing : undefined,
  };
}
