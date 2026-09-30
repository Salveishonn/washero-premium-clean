import { supabase } from "@/integrations/supabase/client";
import {
  RETENTION_PREFERENCE_CHANNEL,
  RETENTION_PREFERENCE_PURPOSE,
  buildRetentionPreferenceWrite,
  requireEvidenceNote,
  type RetentionPreferenceWrite,
  type StoredRetentionConsentStatus,
} from "@/lib/customer-communication-preferences";

export type CustomerCommunicationPreference = {
  id: string;
  customer_id: string;
  channel: string;
  purpose: string;
  status: StoredRetentionConsentStatus;
  opted_in_at: string | null;
  opted_out_at: string | null;
  source: string;
  evidence_note: string;
  recorded_by_admin_user_id: string;
  created_at: string;
  updated_at: string;
};

const PREFERENCE_COLUMNS =
  "id,customer_id,channel,purpose,status,opted_in_at,opted_out_at,source,evidence_note,recorded_by_admin_user_id,created_at,updated_at";

export function retentionPreferenceQueryKey(customerIds: readonly string[]): readonly string[] {
  return [
    "admin",
    "customer-communication-preference",
    "whatsapp",
    "retention",
    [...customerIds].filter(Boolean).sort().join(","),
  ];
}

export function retentionPreferenceCustomerQueryKey(customerId: string): readonly string[] {
  return ["admin", "customer-communication-preference", customerId, "whatsapp", "retention"];
}

function asStoredStatus(status: string): StoredRetentionConsentStatus | null {
  if (status === "opted_in" || status === "opted_out") return status;
  return null;
}

function mapPreference(row: {
  id: string;
  customer_id: string;
  channel: string;
  purpose: string;
  status: string;
  opted_in_at: string | null;
  opted_out_at: string | null;
  source: string;
  evidence_note: string;
  recorded_by_admin_user_id: string;
  created_at: string;
  updated_at: string;
}): CustomerCommunicationPreference | null {
  const status = asStoredStatus(row.status);
  if (!status) return null;
  return { ...row, status };
}

export async function fetchRetentionPreferences(
  customerIds: readonly string[],
): Promise<CustomerCommunicationPreference[]> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("customer_communication_preferences")
    .select(PREFERENCE_COLUMNS)
    .eq("channel", RETENTION_PREFERENCE_CHANNEL)
    .eq("purpose", RETENTION_PREFERENCE_PURPOSE)
    .in("customer_id", ids);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = mapPreference(row);
    return mapped ? [mapped] : [];
  });
}

export async function fetchCustomerPhoneIndex(): Promise<Array<{ id: string; phone: string | null }>> {
  const { data, error } = await supabase.from("customers").select("id, phone").limit(1000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchRetentionPreference(
  customerId: string,
): Promise<CustomerCommunicationPreference | null> {
  const rows = await fetchRetentionPreferences([customerId]);
  return rows[0] ?? null;
}

export async function saveRetentionPreference(input: {
  customerId: string;
  action: "opt_in" | "opt_out";
  evidenceNote: string;
  existingOptedInAt?: string | null;
  now?: string;
}): Promise<RetentionPreferenceWrite> {
  requireEvidenceNote(input.evidenceNote);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("unauthenticated");

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!adminRow?.id || !adminRow.active || !["owner", "admin"].includes(adminRow.role)) {
    throw new Error("forbidden");
  }

  const write = buildRetentionPreferenceWrite({
    customerId: input.customerId,
    action: input.action,
    evidenceNote: input.evidenceNote,
    recordedByAdminUserId: adminRow.id,
    now: input.now ?? new Date().toISOString(),
    existingOptedInAt: input.existingOptedInAt,
  });

  const { error } = await supabase.from("customer_communication_preferences").upsert(write, {
    onConflict: "customer_id,channel,purpose",
  });
  if (error) throw error;
  return write;
}
