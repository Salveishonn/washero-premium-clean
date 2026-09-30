import { describe, expect, it } from "vitest";

import {
  buildRetentionPreferenceWrite,
  canSendRetentionMarketing,
  deriveRetentionConsentStatus,
  duplicateRetentionPhoneCustomerIds,
  PreferenceEvidenceError,
  retentionConsentLabel,
  retentionQueueConsentLabel,
} from "./customer-communication-preferences";

const NOW = "2026-09-29T21:00:00.000Z";
const ADMIN = "11111111-1111-4111-8111-111111111111";

describe("retention consent derivation", () => {
  it("treats a missing row as unknown and not sendable", () => {
    expect(deriveRetentionConsentStatus(null)).toBe("unknown");
    expect(deriveRetentionConsentStatus(undefined)).toBe("unknown");
    expect(canSendRetentionMarketing(null)).toBe(false);
    expect(retentionConsentLabel("unknown")).toBe("Sin consentimiento registrado");
    expect(retentionQueueConsentLabel("unknown")).toBe("Sin consentimiento");
  });

  it("allows retention marketing only when the stored status is opted_in", () => {
    const preference = { status: "opted_in" as const };
    expect(deriveRetentionConsentStatus(preference)).toBe("opted_in");
    expect(canSendRetentionMarketing(preference)).toBe(true);
    expect(retentionConsentLabel("opted_in")).toBe("Consentimiento registrado");
    expect(retentionQueueConsentLabel("opted_in")).toBe("Consentido");
  });

  it("keeps opted_out ineligible without touching other message types", () => {
    const preference = { status: "opted_out" as const };
    expect(canSendRetentionMarketing(preference)).toBe(false);
    expect(retentionConsentLabel("opted_out")).toBe("No desea recibir mensajes");
    expect(retentionQueueConsentLabel("opted_out")).toBe("No contactar");
  });
});

describe("retention preference writes", () => {
  it("rejects blank and whitespace evidence", () => {
    expect(() =>
      buildRetentionPreferenceWrite({
        customerId: "c1",
        action: "opt_in",
        evidenceNote: "   ",
        recordedByAdminUserId: ADMIN,
        now: NOW,
      }),
    ).toThrow(PreferenceEvidenceError);
    expect(() =>
      buildRetentionPreferenceWrite({
        customerId: "c1",
        action: "opt_out",
        evidenceNote: "",
        recordedByAdminUserId: ADMIN,
        now: NOW,
      }),
    ).toThrow(PreferenceEvidenceError);
  });

  it("records an opt-in and preserves a prior opt-in timestamp on opt-out", () => {
    const optedIn = buildRetentionPreferenceWrite({
      customerId: "c1",
      action: "opt_in",
      evidenceNote: "  Cliente pidió el recordatorio.  ",
      recordedByAdminUserId: ADMIN,
      now: NOW,
    });
    expect(optedIn).toMatchObject({
      status: "opted_in",
      channel: "whatsapp",
      purpose: "retention",
      source: "admin_recorded",
      opted_in_at: NOW,
      opted_out_at: null,
      evidence_note: "Cliente pidió el recordatorio.",
      recorded_by_admin_user_id: ADMIN,
    });

    const optedOut = buildRetentionPreferenceWrite({
      customerId: "c1",
      action: "opt_out",
      evidenceNote: "Cliente solicitó no recibir promociones.",
      recordedByAdminUserId: "22222222-2222-4222-8222-222222222222",
      now: "2026-09-30T12:00:00.000Z",
      existingOptedInAt: optedIn.opted_in_at,
    });
    expect(optedOut.status).toBe("opted_out");
    expect(optedOut.opted_in_at).toBe(NOW);
    expect(optedOut.opted_out_at).toBe("2026-09-30T12:00:00.000Z");
    expect(optedOut.recorded_by_admin_user_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("replaces an opt-out with a new explicit opt-in", () => {
    const again = buildRetentionPreferenceWrite({
      customerId: "c1",
      action: "opt_in",
      evidenceNote: "Volvió a pedir el recordatorio por WhatsApp.",
      recordedByAdminUserId: ADMIN,
      now: "2026-10-02T15:00:00.000Z",
      existingOptedInAt: NOW,
    });
    expect(again.status).toBe("opted_in");
    expect(again.opted_in_at).toBe("2026-10-02T15:00:00.000Z");
    expect(again.opted_out_at).toBeNull();
    expect(again.evidence_note).toBe("Volvió a pedir el recordatorio por WhatsApp.");
  });
});

describe("duplicate retention phones", () => {
  it("flags every customer that shares a normalized mobile", () => {
    const ids = duplicateRetentionPhoneCustomerIds([
      { id: "a", phone: "+54 9 11 5555-1212" },
      { id: "b", phone: "5491155551212" },
      { id: "c", phone: "+54 9 11 4444-0000" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});
