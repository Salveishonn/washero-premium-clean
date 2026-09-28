import { supabase } from "@/integrations/supabase/client";
import { notifyOperatorAssignmentPush, type OperatorAssignmentPushResult } from "@/lib/web-push";

export const ADMIN_OPERATOR_STAFF_QUERY_KEY = ["admin", "operator-staff"] as const;

export type AdminOperatorStaffListItem = {
  id: string;
  email: string | null;
  role: string;
  active: boolean;
};

export async function fetchAdminOperatorStaffList(): Promise<AdminOperatorStaffListItem[]> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, email, role, active")
    .eq("active", true)
    .in("role", ["owner", "admin", "operator"])
    .order("email");
  if (error) throw error;
  return (data ?? []) as AdminOperatorStaffListItem[];
}

export async function saveBookingOperatorAssignment(input: {
  bookingId: string;
  previousOperatorId: string | null;
  operatorId: string | null;
  vehicleLabel: string | null;
}): Promise<{ previousOperatorId: string | null; newOperatorId: string | null }> {
  const newOperatorId = input.operatorId;
  const { error } = await supabase
    .from("bookings")
    .update({
      assigned_operator_id: newOperatorId,
      assigned_vehicle_label: input.vehicleLabel,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.bookingId);
  if (error) throw error;
  return { previousOperatorId: input.previousOperatorId, newOperatorId };
}

export async function notifyAssignedOperator(
  bookingId: string,
  operatorId: string,
): Promise<OperatorAssignmentPushResult> {
  return notifyOperatorAssignmentPush(bookingId, operatorId);
}
