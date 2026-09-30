import { parseArgentinaMobile } from "@/lib/phone";

export const RETENTION_PREFERENCE_CHANNEL = "whatsapp" as const;
export const RETENTION_PREFERENCE_PURPOSE = "retention" as const;
export const RETENTION_PREFERENCE_SOURCE = "admin_recorded" as const;

export type RetentionPreferenceChannel = typeof RETENTION_PREFERENCE_CHANNEL;
export type RetentionPreferencePurpose = typeof RETENTION_PREFERENCE_PURPOSE;
export type RetentionPreferenceSource = typeof RETENTION_PREFERENCE_SOURCE;
export type StoredRetentionConsentStatus = "opted_in" | "opted_out";

/** `unknown` is derived when no preference row exists. It is not stored. */
export type MarketingConsentStatus = "unknown" | StoredRetentionConsentStatus;

export type RetentionPreferenceSnapshot = {
  status: StoredRetentionConsentStatus;
  opted_in_at: string | null;
  opted_out_at: string | null;
  evidence_note: string;
  source: RetentionPreferenceSource;
  recorded_by_admin_user_id: string;
};

export type RetentionPreferenceWrite = {
  customer_id: string;
  channel: RetentionPreferenceChannel;
  purpose: RetentionPreferencePurpose;
  status: StoredRetentionConsentStatus;
  opted_in_at: string | null;
  opted_out_at: string | null;
  source: RetentionPreferenceSource;
  evidence_note: string;
  recorded_by_admin_user_id: string;
};

export class PreferenceEvidenceError extends Error {
  constructor() {
    super("evidence_note_required");
    this.name = "PreferenceEvidenceError";
  }
}

export function normalizeEvidenceNote(raw: string | null | undefined): string | null {
  const note = String(raw ?? "").trim();
  return note.length > 0 ? note : null;
}

export function requireEvidenceNote(raw: string | null | undefined): string {
  const note = normalizeEvidenceNote(raw);
  if (!note) throw new PreferenceEvidenceError();
  return note;
}

export function deriveRetentionConsentStatus(
  preference: { status: StoredRetentionConsentStatus } | null | undefined,
): MarketingConsentStatus {
  if (!preference) return "unknown";
  return preference.status;
}

/** Consent gate only. Retention eligibility, phone identity, and template approval are later. */
export function canSendRetentionMarketing(
  preference: { status: StoredRetentionConsentStatus } | null | undefined,
): boolean {
  return deriveRetentionConsentStatus(preference) === "opted_in";
}

export function retentionConsentLabel(status: MarketingConsentStatus): string {
  if (status === "opted_in") return "Consentimiento registrado";
  if (status === "opted_out") return "No desea recibir mensajes";
  return "Sin consentimiento registrado";
}

export function retentionQueueConsentLabel(status: MarketingConsentStatus): string {
  if (status === "opted_in") return "Consentido";
  if (status === "opted_out") return "No contactar";
  return "Sin consentimiento";
}

/**
 * Latest decision only.
 * Opt-out keeps a previous opted_in_at.
 * A new opt-in refreshes opted_in_at and clears opted_out_at.
 */
export function buildRetentionPreferenceWrite(input: {
  customerId: string;
  action: "opt_in" | "opt_out";
  evidenceNote: string;
  recordedByAdminUserId: string;
  now: string;
  existingOptedInAt?: string | null;
}): RetentionPreferenceWrite {
  const evidence_note = requireEvidenceNote(input.evidenceNote);
  if (input.action === "opt_in") {
    return {
      customer_id: input.customerId,
      channel: RETENTION_PREFERENCE_CHANNEL,
      purpose: RETENTION_PREFERENCE_PURPOSE,
      status: "opted_in",
      opted_in_at: input.now,
      opted_out_at: null,
      source: RETENTION_PREFERENCE_SOURCE,
      evidence_note,
      recorded_by_admin_user_id: input.recordedByAdminUserId,
    };
  }
  return {
    customer_id: input.customerId,
    channel: RETENTION_PREFERENCE_CHANNEL,
    purpose: RETENTION_PREFERENCE_PURPOSE,
    status: "opted_out",
    opted_in_at: input.existingOptedInAt ?? null,
    opted_out_at: input.now,
    source: RETENTION_PREFERENCE_SOURCE,
    evidence_note,
    recorded_by_admin_user_id: input.recordedByAdminUserId,
  };
}

export function duplicateRetentionPhoneCustomerIds(
  customers: Array<{ id: string; phone: string | null | undefined }>,
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const customer of customers) {
    const parsed = parseArgentinaMobile(customer.phone);
    if (!parsed.ok) continue;
    const current = groups.get(parsed.national) ?? [];
    current.push(customer.id);
    groups.set(parsed.national, current);
  }
  const duplicated = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) duplicated.add(id);
  }
  return duplicated;
}

export function formatPreferenceRecordedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
