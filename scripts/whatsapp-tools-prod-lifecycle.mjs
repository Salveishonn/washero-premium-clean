#!/usr/bin/env node
/**
 * Production booking lifecycle smokes against whatsapp-tools.
 * Creates real is_test bookings on 5491100000001, then cancels leftovers.
 * Does not log WHATSAPP_TOOLS_SECRET.
 *
 *   WHATSAPP_TOOLS_SECRET=... node scripts/whatsapp-tools-prod-lifecycle.mjs
 */
const URL = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-tools";
const SECRET = (process.env.WHATSAPP_TOOLS_SECRET || "").trim();
const PHONE = process.env.WHATSAPP_SMOKE_PHONE || "5491100000001";
const CONV = process.env.WHATSAPP_SMOKE_CONVERSATION || "smoke-booking-lifecycle";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

if (!SECRET) {
  console.error("WHATSAPP_TOOLS_SECRET is required");
  process.exit(1);
}

async function call(tool, args = {}) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-whatsapp-tools-secret": SECRET,
    },
    body: JSON.stringify({
      tool,
      customer_phone: PHONE,
      conversation_id: CONV,
      customer_name: "Smoke Lifecycle",
      is_test: true,
      args,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body };
}

function slimBooking(b) {
  if (!b || typeof b !== "object") return b;
  return {
    id: b.id,
    service_name: b.service_name,
    vehicle_type: b.vehicle_type,
    scheduled_date: b.scheduled_date,
    scheduled_time: b.scheduled_time,
    neighborhood: b.neighborhood,
    payment_method: b.payment_method,
    payment_status: b.payment_status,
    booking_status: b.booking_status,
    price: b.price,
  };
}

const report = { url: URL, phone: PHONE, conversation_id: CONV, cases: [], created_ids: [] };
const createdIds = [];

function pushCase(name, r, extra = {}) {
  const okFlag = extra.ok ?? (r.status === 200 && r.body?.ok === true);
  const row = {
    name,
    status: r.status,
    ok: okFlag,
    error: r.body?.error || r.body?.reason || null,
    message: r.body?.message || null,
    ...extra,
  };
  report.cases.push(row);
  return row;
}

async function cancelIfPresent(id) {
  if (!id) return;
  await call("cancel_booking", { booking_id: id });
}

try {
  const outsideAddr = await call("validate_service_area", {
    address: "Calle Florida 100, Ciudad Autonoma de Buenos Aires",
    address_type: "street",
  });
  pushCase("validate outside CABA", outsideAddr, {
    ok: outsideAddr.status === 200 && outsideAddr.body?.ok === true &&
      outsideAddr.body?.inside_coverage === false,
    inside_coverage: outsideAddr.body?.inside_coverage ?? null,
    formatted_address: outsideAddr.body?.formatted_address ?? null,
  });

  const services = await call("get_services", {});
  const service = (services.body?.services || [])[0];
  pushCase("get_services", services, {
    ok: services.status === 200 && services.body?.ok === true && Boolean(service?.id),
    service_id: service?.id || null,
    service_name: service?.name || service?.service_name || null,
    payment_methods: services.body?.payment_methods || null,
  });
  if (!service?.id) throw new Error("no production service");

  const outsideWithService = await call("create_booking", {
    customer_name: "Smoke Lifecycle",
    address: outsideAddr.body?.formatted_address || "Calle Florida 100, CABA",
    neighborhood: outsideAddr.body?.neighborhood || "Monserrat",
    address_type: "street",
    service_id: service.id,
    vehicle_type: "Auto",
    scheduled_date: "2099-01-01",
    scheduled_time: "10:00",
    payment_method: "Pagar después",
    formatted_address: outsideAddr.body?.formatted_address || null,
    address_lat: outsideAddr.body?.address_lat,
    address_lng: outsideAddr.body?.address_lng,
    place_id: outsideAddr.body?.place_id || undefined,
    confirmation_message_id: `smoke-outside-svc-${Date.now()}`,
  });
  const outsideReason = outsideWithService.body?.reason || outsideWithService.body?.error || null;
  if (outsideWithService.body?.ok === true && outsideWithService.body?.booking?.id) {
    createdIds.push(outsideWithService.body.booking.id);
  }
  pushCase("create_booking outside coverage with real service", outsideWithService, {
    ok: outsideWithService.status === 200 && outsideWithService.body?.ok === false &&
      (outsideReason === "outside_coverage" || outsideReason === "not_in_coverage"),
    reason: outsideReason,
    booking: slimBooking(outsideWithService.body?.booking),
  });

  const inside = await call("validate_service_area", {
    address: "Avenida de los Lagos 1602, Nordelta, Tigre",
    address_type: "street",
  });
  pushCase("validate Nordelta inside", inside, {
    ok: inside.status === 200 && inside.body?.ok === true && inside.body?.inside_coverage === true,
    inside_coverage: inside.body?.inside_coverage ?? null,
    coverage_zone_name: inside.body?.coverage_zone_name ?? null,
    neighborhood: inside.body?.neighborhood ?? null,
    formatted_address: inside.body?.formatted_address ?? null,
    has_coords: inside.body?.address_lat != null && inside.body?.address_lng != null,
  });
  if (!inside.body?.inside_coverage) throw new Error("Nordelta not inside coverage");

  const dates = await call("get_available_dates", {
    service_id: service.id,
    vehicle_type: "Auto",
  });
  const dateRow = (dates.body?.dates || []).find((d) => (Number(d.slots_available) || 0) > 0);
  pushCase("get_available_dates", dates, {
    ok: dates.status === 200 && dates.body?.ok === true && Boolean(dateRow?.date),
    date: dateRow?.date || null,
    date_count: (dates.body?.dates || []).length,
  });
  if (!dateRow?.date) throw new Error("no available dates");

  const slots = await call("get_available_slots", {
    date: dateRow.date,
    service_id: service.id,
    vehicle_type: "Auto",
  });
  const slot = (slots.body?.slots || [])[0];
  pushCase("get_available_slots", slots, {
    ok: slots.status === 200 && slots.body?.ok === true && Boolean(slot?.start_time),
    date: dateRow.date,
    start_time: slot?.start_time || null,
    slot_count: (slots.body?.slots || []).length,
  });
  if (!slot?.start_time) throw new Error("no available slots");

  const extraSlots = (slots.body?.slots || []).slice(1);
  let mpDate = dateRow.date;
  let mpTime = extraSlots[0] ? String(extraSlots[0].start_time).slice(0, 5) : null;
  let trDate = dateRow.date;
  let trTime = extraSlots[1] ? String(extraSlots[1].start_time).slice(0, 5) : null;
  if (!mpTime || !trTime) {
    const otherDate = (dates.body?.dates || []).find((d) =>
      d.date !== dateRow.date && (Number(d.slots_available) || 0) > 0
    );
    if (otherDate?.date) {
      const more = await call("get_available_slots", {
        date: otherDate.date,
        service_id: service.id,
        vehicle_type: "Auto",
      });
      const moreSlots = more.body?.slots || [];
      if (!mpTime && moreSlots[0]) {
        mpDate = otherDate.date;
        mpTime = String(moreSlots[0].start_time).slice(0, 5);
      }
      if (!trTime && moreSlots[1]) {
        trDate = otherDate.date;
        trTime = String(moreSlots[1].start_time).slice(0, 5);
      } else if (!trTime && moreSlots[0] && `${otherDate.date}|${String(moreSlots[0].start_time).slice(0, 5)}` !== `${mpDate}|${mpTime}`) {
        trDate = otherDate.date;
        trTime = String(moreSlots[0].start_time).slice(0, 5);
      }
    }
  }
  if (!mpTime) mpTime = String(slot.start_time).slice(0, 5);
  if (!trTime) trTime = mpTime;

  const locked = {
    customer_name: "Smoke Lifecycle",
    address: inside.body.formatted_address || "Avenida de los Lagos 1602, Nordelta",
    neighborhood: inside.body.neighborhood || inside.body.coverage_zone_name || "Nordelta",
    address_type: "street",
    service_id: service.id,
    vehicle_type: "Auto",
    scheduled_date: dateRow.date,
    scheduled_time: String(slot.start_time).slice(0, 5),
    formatted_address: inside.body.formatted_address,
    address_lat: inside.body.address_lat,
    address_lng: inside.body.address_lng,
    place_id: inside.body.place_id || undefined,
    coverage_zone_id: inside.body.coverage_zone_id || undefined,
    coverage_zone_name: inside.body.coverage_zone_name || undefined,
  };

  async function createWithMethod(payment_method, confirmation_message_id, slotOverride = {}) {
    return call("create_booking", {
      ...locked,
      ...slotOverride,
      payment_method,
      confirmation_message_id,
    });
  }

  const later = await createWithMethod("Pagar después", `smoke-later-${Date.now()}`);
  const laterId = later.body?.booking?.id || null;
  if (laterId) createdIds.push(laterId);
  pushCase("create_booking Pagar después", later, {
    booking: slimBooking(later.body?.booking),
  });
  if (!laterId) throw new Error("failed to create Pagar después booking");

  const listed = await call("list_customer_bookings", { limit: 10 });
  const listedIds = (listed.body?.bookings || []).map((b) => b.id);
  pushCase("list_customer_bookings includes new booking", listed, {
    ok: listed.status === 200 && listed.body?.ok === true && listedIds.includes(laterId),
    listed_count: listedIds.length,
  });

  const otherDate = (dates.body?.dates || []).find((d) =>
    d.date !== dateRow.date && (Number(d.slots_available) || 0) > 0
  ) || dateRow;
  const otherSlots = await call("get_available_slots", {
    date: otherDate.date,
    service_id: service.id,
    vehicle_type: "Auto",
  });
  const otherSlot = (otherSlots.body?.slots || []).find((s) =>
    !(otherDate.date === dateRow.date && String(s.start_time).slice(0, 5) === locked.scheduled_time)
  ) || (otherSlots.body?.slots || [])[0];
  const rescheduled = await call("reschedule_booking", {
    booking_id: laterId,
    new_date: otherDate.date,
    new_time: String(otherSlot?.start_time || "16:00").slice(0, 5),
  });
  pushCase("reschedule_booking", rescheduled, {
    ok: rescheduled.status === 200 && rescheduled.body?.ok === true,
    new_date: otherDate.date,
    new_time: String(otherSlot?.start_time || "").slice(0, 5),
    booking: slimBooking(rescheduled.body?.booking || rescheduled.body),
  });

  const cancelledLater = await call("cancel_booking", { booking_id: laterId });
  pushCase("cancel_booking Pagar después", cancelledLater, {
    ok: cancelledLater.status === 200 && cancelledLater.body?.ok === true,
  });

  const mp = await createWithMethod("MercadoPago", `smoke-mp-${Date.now()}`, {
    scheduled_date: mpDate,
    scheduled_time: mpTime,
  });
  const mpId = mp.body?.booking?.id || null;
  if (mpId) createdIds.push(mpId);
  pushCase("create_booking MercadoPago", mp, { booking: slimBooking(mp.body?.booking) });
  if (!mpId) throw new Error("failed to create MercadoPago booking");

  const payLink = await call("get_payment_link", { booking_id: mpId });
  const checkout = payLink.body?.checkout_url || null;
  pushCase("get_payment_link", payLink, {
    ok: payLink.status === 200 && payLink.body?.ok === true &&
      (typeof checkout === "string" && checkout.startsWith("http") || payLink.body?.already_paid === true),
    has_checkout_url: typeof checkout === "string" && checkout.startsWith("http"),
    reused: payLink.body?.reused === true,
    already_paid: payLink.body?.already_paid === true,
    checkout_host: checkout ? new URL(checkout).host : null,
  });

  const tr = await createWithMethod("Transferencia", `smoke-tr-${Date.now()}`, {
    scheduled_date: trDate,
    scheduled_time: trTime,
  });
  const trId = tr.body?.booking?.id || null;
  if (trId) createdIds.push(trId);
  pushCase("create_booking Transferencia", tr, { booking: slimBooking(tr.body?.booking) });
  if (!trId) throw new Error("failed to create Transferencia booking");

  const bank = await call("get_bank_transfer_details", { booking_id: trId });
  pushCase("get_bank_transfer_details for booking", bank, {
    has_alias: Boolean(bank.body?.alias),
    has_cbu: Boolean(bank.body?.cbu),
    has_customer_message: Boolean(bank.body?.customer_message),
    amount: bank.body?.amount ?? null,
  });

  const receipt = await call("ingest_receipt", {
    media_base64: PNG_1X1,
    mime_type: "image/png",
    file_name: "smoke-comprobante.png",
    message_type: "image",
    message_id: `smoke-receipt-${Date.now()}`,
    booking_id: trId,
  });
  pushCase("ingest_receipt auto-paid", receipt, {
    ok: receipt.status === 200 && receipt.body?.ok === true &&
      receipt.body?.paid === true &&
      (receipt.body?.receipt_status === "approved" || receipt.body?.receipt_status === "approved"),
    receipt_id: receipt.body?.receipt_id || null,
    booking_id: receipt.body?.booking_id || trId,
    receipt_status: receipt.body?.receipt_status || null,
    paid: receipt.body?.paid ?? null,
    invoice_ok: receipt.body?.invoice?.ok ?? null,
    invoice_channel: receipt.body?.invoice?.channel ?? null,
    invoice_error: receipt.body?.invoice?.error ?? null,
  });

  const paidBooking = await call("get_booking", { booking_id: trId });
  pushCase("get_booking after transfer paid", paidBooking, {
    ok: paidBooking.status === 200 && paidBooking.body?.ok === true &&
      paidBooking.body?.booking?.payment_status === "paid",
    booking: slimBooking(paidBooking.body?.booking),
  });

  const dup = await call("ingest_receipt", {
    media_base64: PNG_1X1,
    mime_type: "image/png",
    file_name: "smoke-comprobante-dup.png",
    message_type: "image",
    message_id: `smoke-receipt-dup-${Date.now()}`,
    booking_id: trId,
  });
  pushCase("ingest_receipt duplicate does not fail hard", dup, {
    ok: dup.status === 200 && dup.body?.ok === true,
    paid: dup.body?.paid ?? null,
    receipt_status: dup.body?.receipt_status || null,
    duplicate: dup.body?.duplicate ?? dup.body?.error ?? null,
  });
} catch (err) {
  report.fatal = String(err?.message || err);
} finally {
  report.created_ids = createdIds;
  const keepPaid = report.cases.find((c) => c.name === "ingest_receipt auto-paid")?.booking_id ||
    report.cases.find((c) => c.name === "create_booking Transferencia")?.booking?.id;
  for (const id of createdIds) {
    if (id && id !== keepPaid) await cancelIfPresent(id);
  }
  report.cleanup_kept_paid_booking_id = keepPaid || null;
}

const failed = report.cases.filter((c) => c.ok === false);
report.failed = failed.map((c) => c.name);
console.log(JSON.stringify(report, null, 2));
process.exit(report.fatal || failed.length ? 1 : 0);
