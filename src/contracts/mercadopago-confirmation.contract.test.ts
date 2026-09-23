import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 0.5)
 *
 * Mercado Pago success may promote pending → confirmed.
 * It must not rewrite other business statuses to confirmed.
 */
const WEBHOOK = "supabase/functions/mercadopago-webhook/index.ts";

describe("Mercado Pago confirmation contract", () => {
  const source = readRepoFile(WEBHOOK);

  it("promotes booking_status to confirmed only when the booking was pending and payment is paid", () => {
    expect(source).toContain(
      'if (newPaymentStatus === "paid" && bookingBefore?.booking_status === "pending")',
    );
    expect(source).toContain('bookingUpdate.booking_status = "confirmed"');
  });

  it("does not assign confirmed from in_progress, completed, cancelled, or needs_review", () => {
    const promote = source.match(
      /if \(newPaymentStatus === "paid" && bookingBefore\?\.booking_status === "pending"\) \{\s*bookingUpdate\.booking_status = "confirmed";\s*\}/,
    );
    expect(promote).not.toBeNull();

    const assignments = [...source.matchAll(/bookingUpdate\.booking_status\s*=\s*"([^"]+)"/g)].map(
      (item) => item[1],
    );
    expect(assignments).toEqual(["confirmed"]);
    expect(source).not.toMatch(/booking_status === "(in_progress|completed|cancelled|needs_review)"[\s\S]{0,120}confirmed/);
  });
});
