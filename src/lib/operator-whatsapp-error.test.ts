import { describe, expect, it } from "vitest";
import { operatorWhatsappErrorMessage } from "@/lib/operator";

describe("operatorWhatsappErrorMessage", () => {
  it("does not surface the generic supabase non-2xx string", () => {
    expect(
      operatorWhatsappErrorMessage({
        invokeError: "Edge Function returned a non-2xx status code",
      }),
    ).toBe("No pudimos enviar el WhatsApp. Revisá notificaciones/admin.");
  });

  it("prefers the edge function body message", () => {
    expect(
      operatorWhatsappErrorMessage({
        status: "failed",
        message: "WhatsApp rechazó el envío. Revisá las credenciales de Meta en las Edge Functions.",
        invokeError: "Edge Function returned a non-2xx status code",
      }),
    ).toContain("credenciales de Meta");
  });

  it("maps booking_forbidden", () => {
    expect(operatorWhatsappErrorMessage({ status: "booking_forbidden" })).toBe(
      "No podés enviar mensajes para esta reserva.",
    );
  });
});
