// Edge Function: payment-qr
// GET ?b=<booking_id>&s=<signature> → PNG QR of the booking's Mercado Pago checkout link.
// Public on purpose (WhatsApp downloads the image), protected by the HMAC signature built
// in _shared/payment-qr.ts. Deploy with verify_jwt = false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";
import { verifyPaymentQr } from "../_shared/payment-qr.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function notFound() {
  return new Response("not found", { status: 404 });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const bookingId = (url.searchParams.get("b") ?? "").trim();
  const sig = (url.searchParams.get("s") ?? "").trim();
  if (!(await verifyPaymentQr(bookingId, sig))) return notFound();

  const { data: booking } = await admin
    .from("bookings")
    .select("id,payment_status")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return notFound();

  const { data: pay } = await admin
    .from("payments")
    .select("raw_payload")
    .eq("booking_id", bookingId)
    .eq("provider", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = (pay?.raw_payload ?? null) as Record<string, unknown> | null;
  const checkoutUrl = (raw?.init_point as string | undefined) ?? (raw?.sandbox_init_point as string | undefined);
  if (!checkoutUrl) return notFound();

  const png: Uint8Array = await QRCode.toBuffer(checkoutUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    color: { dark: "#0B1F3A", light: "#FFFFFF" },
  });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
