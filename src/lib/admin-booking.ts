import { supabase } from "@/integrations/supabase/client";

export const ADMIN_PAYMENT_METHODS = ["MercadoPago", "Transferencia", "Pagar después"] as const;
export type AdminPaymentMethod = (typeof ADMIN_PAYMENT_METHODS)[number];

export const ADMIN_VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;

export type CreateAdminBookingPayload = {
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  service_id: string;
  service_name?: string;
  scheduled_date: string;
  scheduled_time: string;
  payment_method: string;
  payment_status?: string;
  booking_status?: string;
  booking_source?: "admin" | "botmaker";
  notes?: string | null;
  selected_extras?: string[];
  /** Final price override (admin discounts / friends & family). */
  price_override?: number | null;
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  is_test?: boolean;
  booking_request_id?: string | null;
  conversation_id?: string | null;
};

export type CreateAdminBookingResponse = {
  ok: boolean;
  status?: string;
  customer_message?: string;
  missing?: string[];
  booking_id?: string;
  booking_status?: string;
  payment_status?: string;
  price?: number;
  vehicle_surcharge?: number;
  extras_total?: number;
};

export async function invokeCreateAdminBooking(
  payload: CreateAdminBookingPayload,
): Promise<CreateAdminBookingResponse> {
  const { data, error } = await supabase.functions.invoke("create-admin-booking", { body: payload });
  if (error) {
    return { ok: false, status: "server_error", customer_message: error.message };
  }
  return (data ?? { ok: false, status: "server_error" }) as CreateAdminBookingResponse;
}
