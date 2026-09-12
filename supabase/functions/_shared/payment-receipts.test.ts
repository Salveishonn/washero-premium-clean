import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asPostgresUuid,
  downloadWhatsAppCloudMedia,
  settleTransferReceiptAsPaid,
  splitReceiptMessageId,
} from "./payment-receipts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Row = Record<string, unknown>;

function mockAdmin(opts: {
  booking: Row | null;
  receiptUpdateError?: { message: string } | null;
  bookingUpdateError?: { message: string } | null;
  updates: Array<{ table: string; payload: Row }>;
  inserts: Array<{ table: string; payload: Row }>;
}): SupabaseClient {
  const from = (table: string) => {
    const result = () => ({
      data: table === "bookings" ? opts.booking : table === "invoices" ? null : [],
      error: null,
    });
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.gte = self;
    api.order = self;
    api.limit = self;
    api.maybeSingle = async () => ({
      data: table === "bookings" ? opts.booking : null,
      error: null,
    });
    api.single = api.maybeSingle;
    api.update = (payload: Row) => {
      opts.updates.push({ table, payload });
      const err = table === "bookings"
        ? opts.bookingUpdateError ?? null
        : table === "payment_receipts"
        ? opts.receiptUpdateError ?? null
        : null;
      const upd: Record<string, unknown> = {
        eq: () => Promise.resolve({ error: err }),
        error: err,
        then: (resolve: (v: unknown) => unknown) => resolve({ error: err }),
      };
      return upd;
    };
    api.insert = (payload: Row) => {
      opts.inserts.push({ table, payload });
      return {
        select: self,
        maybeSingle: async () => ({ data: { id: "x" }, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
    };
    Object.assign(api, result());
    return api;
  };
  return {
    from,
    rpc: async () => ({ data: null, error: { message: "skip-invoice-in-unit-test" } }),
  } as unknown as SupabaseClient;
}

Deno.test("settleTransferReceiptAsPaid marks booking paid and approves receipt", async () => {
  Deno.env.set("WASHERO_SKIP_RECEIPT_NOTIFY", "1");
  const updates: Array<{ table: string; payload: Row }> = [];
  const inserts: Array<{ table: string; payload: Row }> = [];
  const admin = mockAdmin({
    booking: { id: "b1", booking_status: "pending", payment_status: "pending", price: 28000 },
    updates,
    inserts,
  });
  const result = await settleTransferReceiptAsPaid(admin, {
    receiptId: "r1",
    bookingId: "b1",
    notes: "auto_from_whatsapp",
  });
  assertEquals(result.ok, true);
  assertEquals(result.paid, true);
  assertEquals(result.already_paid, false);
  assertEquals(updates.some((u) => u.table === "bookings" && u.payload.payment_status === "paid"), true);
  assertEquals(updates.some((u) => u.table === "bookings" && u.payload.booking_status === "confirmed"), true);
  assertEquals(updates.some((u) => u.table === "payment_receipts" && u.payload.status === "approved"), true);
  assertEquals(updates.find((u) => u.table === "payment_receipts")?.payload.notes, "auto_from_whatsapp");
  assertEquals(inserts.some((i) => i.table === "payments" && i.payload.provider === "manual"), true);
});

Deno.test("settleTransferReceiptAsPaid does not insert a second payment if already paid", async () => {
  Deno.env.set("WASHERO_SKIP_RECEIPT_NOTIFY", "1");
  const updates: Array<{ table: string; payload: Row }> = [];
  const inserts: Array<{ table: string; payload: Row }> = [];
  const admin = mockAdmin({
    booking: { id: "b1", booking_status: "confirmed", payment_status: "paid", price: 28000 },
    updates,
    inserts,
  });
  const result = await settleTransferReceiptAsPaid(admin, { receiptId: "r1", bookingId: "b1" });
  assertEquals(result.ok, true);
  assertEquals(result.already_paid, true);
  assertEquals(inserts.filter((i) => i.table === "payments").length, 0);
  assertEquals(updates.some((u) => u.table === "bookings"), false);
});

Deno.test("downloadWhatsAppCloudMedia is a no-op without token or media id", async () => {
  const prev = Deno.env.get("WHATSAPP_CLOUD_ACCESS_TOKEN");
  Deno.env.delete("WHATSAPP_CLOUD_ACCESS_TOKEN");
  try {
    assertEquals(await downloadWhatsAppCloudMedia(""), null);
    assertEquals(await downloadWhatsAppCloudMedia("123"), null);
  } finally {
    if (prev == null) Deno.env.delete("WHATSAPP_CLOUD_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_CLOUD_ACCESS_TOKEN", prev);
  }
});

Deno.test("splitReceiptMessageId keeps Botmaker uuids off Graph wamid strings", () => {
  assertEquals(asPostgresUuid("wamid.ABC"), null);
  assertEquals(asPostgresUuid("smoke-receipt-1"), null);
  assertEquals(asPostgresUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  assertEquals(splitReceiptMessageId("wamid.R1"), {
    botmakerMessageId: null,
    externalMessageId: "wamid.R1",
  });
  assertEquals(splitReceiptMessageId("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), {
    botmakerMessageId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    externalMessageId: null,
  });
});
