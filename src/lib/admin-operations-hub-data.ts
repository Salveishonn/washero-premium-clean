import { supabase } from "@/integrations/supabase/client";
import type { HubOperationInput, HubReceiptInput } from "@/lib/admin-operations-hub";

export async function fetchHubOperations(bookingIds: string[]): Promise<HubOperationInput[]> {
  if (bookingIds.length === 0) return [];
  const { data, error } = await supabase
    .from("booking_operations")
    .select("booking_id, phase, current_operator_id, phase_changed_at")
    .in("booking_id", bookingIds);
  if (error) throw error;
  return (data ?? []) as HubOperationInput[];
}

export async function fetchHubReceipts(bookingIds: string[]): Promise<HubReceiptInput[]> {
  if (bookingIds.length === 0) return [];
  const { data, error } = await supabase
    .from("payment_receipts")
    .select("booking_id, status, created_at")
    .in("booking_id", bookingIds);
  if (error) throw error;
  return ((data ?? []) as Array<HubReceiptInput | { booking_id: string | null }>).filter(
    (row): row is HubReceiptInput => typeof row.booking_id === "string" && row.booking_id.length > 0,
  );
}
