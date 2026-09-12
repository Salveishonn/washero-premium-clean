import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(root, "scripts/n8n-washero-flow-router.js"), "utf8");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(opts) {
  const norm = {
    phone: "5491122334455",
    name: "Pedro",
    conversation_id: "5491122334455",
    message_type: "text",
    message_text: "",
    reply_id: "",
    reply_title: "",
    external_message_id: "wamid.1",
    media_id: "",
    mime_type: "",
    file_name: "",
    lat: null,
    lng: null,
    ...(opts.norm || {}),
  };
  const context = {
    $: (name) => ({
      first: () => ({ json: name === "Normalize Inbound" ? norm : {} }),
    }),
    $input: {
      first: () => ({
        json: {
          state: opts.state || "none",
          data: opts.data || {},
          results: opts.results || [],
        },
      }),
    },
  };
  createContext(context);
  const wrapped = "(function () {\n" + code + "\n})()";
  const out = runInContext(wrapped, context, { timeout: 2000 });
  assert.ok(Array.isArray(out) && out[0] && out[0].json, "router must return [{json}]");
  return clone(out[0].json);
}

function listRowIds(json) {
  const rows = json.payload?.interactive?.action?.sections?.[0]?.rows || [];
  return rows.map((r) => r.id);
}

{
  const j = run({ state: "none", norm: { message_text: "hola" } });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "menu");
  const ids = listRowIds(j);
  assert.deepEqual(ids, [
    "menu:reservar",
    "menu:reservas",
    "menu:zonas",
    "menu:servicios",
    "menu:humano",
  ]);
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    norm: { message_type: "interactive", reply_id: "menu:reservar", reply_title: "Reservar" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "addrtype");
  const btnIds = (j.payload?.interactive?.action?.buttons || []).map((b) => b.reply.id);
  assert.ok(btnIds.includes("at:street"));
  assert.ok(btnIds.includes("at:priv"));
}

{
  const j = run({
    state: "streetpick",
    data: { address_type: "street", address_raw: "Calle Falsa 123, Rosario", misses: 0 },
    results: [{
      tool: "validate_service_area",
      result: { ok: true, inside_coverage: false, formatted_address: "Rosario" },
    }],
    norm: { message_type: "interactive", reply_id: "sug:none", reply_title: "Ninguna" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "outside");
  assert.equal(String(j.log_text).includes("get_available"), false);
  assert.equal(j.payload?.interactive?.action?.buttons?.[0]?.reply?.id, "out:retry");
}

{
  const locked = {
    misses: 0,
    address: "Libertador 1234",
    formatted_address: "Av. del Libertador 1234, Martínez",
    neighborhood: "Martínez",
    address_type: "street",
    address_lat: -34.49,
    address_lng: -58.5,
    place_id: "ChIJabc",
    coverage_zone_id: "z1",
    service_id: "svc1",
    service_name: "Completo",
    vehicle_type: "Auto",
    selected_extras: [],
    scheduled_date: "2026-09-20",
    scheduled_time: "10:00",
    payment_method: "Transferencia",
    customer_name: "Pedro",
    price: 28000,
  };
  const created = run({
    state: "confirm",
    data: locked,
    results: [{
      tool: "create_booking",
      result: { ok: true, booking: { id: "bk-99", service_name: "Completo", vehicle_type: "Auto", scheduled_date: "2026-09-20", scheduled_time: "10:00", address: locked.address, price: 28000 } },
    }],
    norm: { message_type: "interactive", reply_id: "cf:yes", reply_title: "Confirmar" },
  });
  assert.equal(created.action, "call");
  assert.equal(created.tool, "get_bank_transfer_details");
  assert.equal(created.args.booking_id, "bk-99");
}

{
  const j = run({
    state: "await_receipt",
    data: { awaiting_receipt: true, booking_id: "bk-99", misses: 0 },
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg", external_message_id: "wamid.img" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "ingest_receipt");
  assert.equal(j.args.media_id, "MEDIA99");
  assert.equal(j.args.booking_id, "bk-99");
}

{
  const j = run({
    state: "pay",
    data: {
      misses: 0,
      service_id: "svc1",
      service_name: "Completo",
      vehicle_type: "Auto",
      scheduled_date: "2026-09-20",
      scheduled_time: "10:00",
      address: "X",
      formatted_address: "X",
      neighborhood: "Martínez",
      price: 28000,
    },
    results: [{ tool: "calculate_booking_price", result: { ok: true, total_amount: 28000 } }],
    norm: { message_type: "interactive", reply_id: "pay:later", reply_title: "Pagar después" },
  });
  assert.equal(j.next_state, "confirm");
  assert.equal(j.next_data.payment_method, "Pagar después");
}

{
  const j = run({
    state: "confirm",
    data: {
      misses: 0,
      address: "Libertador 1234",
      formatted_address: "Av. del Libertador 1234, Martínez",
      neighborhood: "Martínez",
      address_type: "street",
      address_lat: -34.49,
      address_lng: -58.5,
      place_id: "ChIJabc",
      service_id: "svc1",
      service_name: "Completo",
      vehicle_type: "Auto",
      selected_extras: ["interior"],
      scheduled_date: "2026-09-20",
      scheduled_time: "10:00",
      payment_method: "MercadoPago",
      customer_name: "Pedro",
      price: 30000,
    },
    norm: { message_type: "interactive", reply_id: "cf:yes", reply_title: "Confirmar" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "create_booking");
  assert.equal(j.args.address_lat, -34.49);
  assert.equal(j.args.address_lng, -58.5);
  assert.equal(j.args.place_id, "ChIJabc");
  assert.deepEqual(j.args.selected_extras, ["interior"]);
  assert.equal(j.args.payment_method, "MercadoPago");
}

{
  const j = run({
    state: "confirm",
    data: {
      misses: 0,
      payment_method: "MercadoPago",
      service_name: "Completo",
      vehicle_type: "Auto",
      scheduled_date: "2026-09-20",
      scheduled_time: "10:00",
      address: "X",
      price: 30000,
    },
    results: [{
      tool: "create_booking",
      result: { ok: true, booking: { id: "bk-mp", service_name: "Completo", vehicle_type: "Auto", scheduled_date: "2026-09-20", scheduled_time: "10:00", address: "X", price: 30000 } },
    }],
    norm: { message_type: "interactive", reply_id: "cf:yes", reply_title: "Confirmar" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "get_payment_link");
  assert.equal(j.args.booking_id, "bk-mp");
}

{
  const j = run({
    state: "await_receipt",
    data: { awaiting_receipt: true, booking_id: "bk-99", misses: 0 },
    results: [{
      tool: "ingest_receipt",
      result: { ok: true, paid: true, receipt_status: "approved" },
    }],
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "none");
  assert.equal(String(j.log_text).toLowerCase().includes("pagada"), true);
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    norm: { message_type: "interactive", reply_id: "menu:reservas", reply_title: "Mis reservas" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "list_customer_bookings");
}

{
  const j = run({
    state: "rtime",
    data: { sel_booking_id: "bk-1", new_date: "2026-09-22", new_time: "11:00", misses: 0 },
    norm: { message_type: "interactive", reply_id: "time:11:00", reply_title: "11:00 hs" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "reschedule_booking");
  assert.equal(j.args.booking_id, "bk-1");
  assert.equal(j.args.new_date, "2026-09-22");
  assert.equal(j.args.new_time, "11:00");
}

{
  const j = run({
    state: "cxlconf",
    data: { sel_booking_id: "bk-1", misses: 0 },
    norm: { message_type: "interactive", reply_id: "cf:yes", reply_title: "Sí, cancelar" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "cancel_booking");
  assert.equal(j.args.booking_id, "bk-1");
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    norm: { message_type: "interactive", reply_id: "menu:zonas", reply_title: "Cobertura" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "list_coverage_zones");
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    norm: { message_type: "interactive", reply_id: "menu:servicios", reply_title: "Precios" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "get_services");
}

console.log("n8n-washero-flow-router.test.mjs: ok");
