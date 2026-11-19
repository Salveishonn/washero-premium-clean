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
  // Like live n8n: exists / promo_notice_pending only live on the Get Conversation State node.
  // $input is Collect Tool Result's output on later passes, which forwards state/data/results.
  const conv = {
    ok: true,
    state: opts.state || "none",
    data: opts.data || {},
    ...(opts.exists === undefined ? {} : { exists: opts.exists }),
    ...(opts.pending === undefined ? {} : { promo_notice_pending: opts.pending }),
    ...(opts.conv || {}),
  };
  const context = {
    $: (name) => ({
      first: () => ({ json: name === "Normalize Inbound" ? norm : name === "Get Conversation State" ? conv : {} }),
    }),
    $input: {
      first: () => ({
        json: {
          state: opts.state || "none",
          data: opts.data || {},
          results: opts.results || [],
          receipt_capture: opts.receipt_capture || null,
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
    "menu:info",
    "menu:humano",
  ]);
}

{
  // "Reservar" opens the WhatsApp Flow booking form.
  const j = run({
    state: "menu",
    data: { misses: 0 },
    norm: { message_type: "interactive", reply_id: "menu:reservar", reply_title: "Reservar turno" },
  });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "start_booking_form");
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    results: [{ tool: "start_booking_form", result: { ok: true, flow_id: "FLOW1", flow_token: "tok.abc", mode: "published" } }],
    norm: { message_type: "interactive", reply_id: "menu:reservar", reply_title: "Reservar turno" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "form");
  assert.equal(j.next_data.flow_token, "tok.abc");
  assert.equal(j.payload.interactive.type, "flow");
  const params = j.payload.interactive.action.parameters;
  assert.equal(params.flow_id, "FLOW1");
  assert.equal(params.flow_token, "tok.abc");
  assert.equal(params.flow_action, "data_exchange");
  assert.equal(params.mode, undefined);
}

{
  // Form not configured: fall back to the step-by-step flow.
  const j = run({
    state: "menu",
    data: { misses: 0 },
    results: [{ tool: "start_booking_form", result: { ok: false, error: "flow_not_configured" } }],
    norm: { message_type: "interactive", reply_id: "menu:reservar", reply_title: "Reservar turno" },
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
      coverage_zone_id: "z1",
      coverage_zone_name: "Tigre",
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
  assert.equal(j.args.coverage_zone_id, "z1");
  assert.equal(j.args.coverage_zone_name, "Tigre");
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
    state: "menu",
    data: { misses: 0 },
    receipt_capture: { ok: true, outcome: "pending_review", captured: true, duplicate: false, receipt_status: "pending_review", booking_matched: true },
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg", external_message_id: "wamid.img" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "none");
  assert.equal(String(j.log_text).includes("lo vamos a revisar"), true);
  assert.equal(String(j.log_text).toLowerCase().includes("pagada"), false);
}

{
  const j = run({
    state: "svc",
    data: { misses: 0, service_id: "svc1" },
    receipt_capture: { ok: true, outcome: "unresolved", captured: true, duplicate: false, receipt_status: "unresolved", booking_matched: false },
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg" },
  });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "none");
  assert.equal(String(j.log_text).toLowerCase().includes("pagada"), false);
}

{
  const j = run({
    state: "menu",
    data: { misses: 0 },
    receipt_capture: { ok: true, outcome: "not_eligible", captured: false, duplicate: false, receipt_status: null, booking_matched: false },
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg" },
  });
  assert.equal(j.action, "reply");
  assert.equal(String(j.log_text).includes("Si es un comprobante de transferencia"), false);
}

{
  const j = run({
    state: "none",
    norm: { message_text: "quiero reservar un lavado" },
  });
  // Obvious intent skips the menu and goes straight to the form.
  assert.equal(j.action, "call");
  assert.equal(j.tool, "start_booking_form");
}

{
  const j = run({
    state: "await_receipt",
    data: { awaiting_receipt: true, booking_id: "bk-99", misses: 0 },
    results: [{
      tool: "ingest_receipt",
      result: { ok: true, outcome: "pending_review", paid: true, receipt_status: "pending_review" },
    }],
    norm: { message_type: "image", media_id: "MEDIA99", mime_type: "image/jpeg" },
  });
  assert.equal(j.action, "reply");
  assert.equal(String(j.log_text).toLowerCase().includes("pagada"), false);
  assert.equal(String(j.log_text).includes("lo vamos a revisar"), true);
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
    results: [{ tool: "get_services", result: { ok: true, services: [] } }],
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

{
  const j = run({ state: "none", norm: { message_type: "button", message_text: "Sí, quiero promos" } });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "menu");
  assert.match(j.log_text, /avisar por acá cuando haya promos/);
}

{
  const j = run({ state: "pay", data: { misses: 1 }, norm: { message_type: "button", message_text: "No recibir promos" } });
  assert.equal(j.action, "reply");
  assert.equal(j.next_state, "none");
  assert.match(j.log_text, /no te vamos a mandar más promociones/);
}

{
  const j = run({ state: "none", norm: { message_type: "button", message_text: "Otra cosa" } });
  assert.equal(j.next_state, "menu");
  assert.doesNotMatch(j.log_text, /no puedo procesar/);
}

console.log("promo button replies ok");

// --- Reactions are ignored ---------------------------------------------------
for (const state of ["none", "menu", "await_receipt", "form"]) {
  const data = { misses: 1, booking_id: "bk-1" };
  const j = run({ state, data, norm: { message_type: "reaction", message_text: "" } });
  assert.equal(j.action, "reply");
  assert.equal(j.has_message, false, `reaction in ${state} must not answer`);
  assert.equal(j.next_state, state);
  assert.deepEqual(j.next_data, data);
}

// --- "gracias" closes politely ------------------------------------------------
for (const text of ["gracias", "Muchas gracias!!", "ok genial, gracias", "dale gracias", "👍", "🙏🏻", "perfecto, muchas gracias por la info", "Graciassss"]) {
  const j = run({ state: "none", norm: { message_text: text } });
  assert.equal(j.next_state, "closed", `"${text}" should close`);
  assert.match(j.log_text, /Gracias a vos, Pedro/);
  assert.doesNotMatch(j.log_text, /no te entendí/);
}
{
  const j = run({ state: "menu", data: { misses: 0 }, norm: { message_text: "gracias" } });
  assert.equal(j.next_state, "closed");
}
{
  // A second "gracias" after closing: silence instead of a ping-pong.
  const j = run({ state: "closed", norm: { message_text: "gracias!" } });
  assert.equal(j.has_message, false);
}
{
  // Mid-booking: keep the draft, no miss counted.
  const data = { misses: 1, service_id: "svc1" };
  const j = run({ state: "veh", data, norm: { message_text: "ok gracias" } });
  assert.equal(j.next_state, "veh");
  assert.deepEqual(j.next_data, data);
  assert.match(j.log_text, /De nada/);
}
{
  const j = run({ state: "await_receipt", data: { awaiting_receipt: true, booking_id: "bk-1" }, norm: { message_text: "gracias" } });
  assert.equal(j.next_state, "await_receipt");
  assert.match(j.log_text, /comprobante/);
}
for (const text of ["no", "si", "bueno", "gracias pero quiero cambiar el horario", "hola"]) {
  const j = run({ state: "none", norm: { message_text: text } });
  assert.notEqual(j.next_state, "closed", `"${text}" must not close`);
}

// --- First contact: greeting + discreet promo notice -------------------------
{
  const j = run({ state: "none", exists: false, norm: { message_text: "hola" } });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "record_marketing_notice");
}
{
  const j = run({
    state: "none",
    exists: false,
    results: [{ tool: "record_marketing_notice", result: { ok: true } }],
    norm: { message_text: "hola" },
  });
  assert.equal(j.next_state, "menu");
  assert.match(j.log_text, /Hola Pedro/);
  assert.match(j.log_text, /Agendamos tu número para avisarte de promos/);
  assert.ok(listRowIds(j).includes("menu:nopromos"));
}
{
  // Returning customer: no notice.
  const j = run({ state: "none", exists: true, norm: { message_text: "hola" } });
  assert.equal(j.action, "reply");
  assert.doesNotMatch(j.log_text, /Agendamos tu número/);
  assert.ok(!listRowIds(j).includes("menu:nopromos"));
}
for (const msg of [{ message_text: "no promos" }, { message_type: "interactive", reply_id: "menu:nopromos", message_text: "No recibir promos" }]) {
  const j = run({ state: "menu", data: { misses: 0 }, norm: msg });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "set_marketing_consent");
  assert.equal(j.args.consent, "opt_out");
}

// --- Form submission -> booking -> Mercado Pago QR + alias -------------------
const formNorm = { message_type: "interactive", flow_response: { flow_token: "tok.abc" }, external_message_id: "wamid.form" };
{
  const j = run({ state: "form", data: { misses: 0, flow_token: "tok.abc" }, norm: formNorm });
  assert.equal(j.action, "call");
  assert.equal(j.tool, "create_booking_from_form");
  assert.equal(j.args.flow_token, "tok.abc");
  assert.equal(j.args.confirmation_message_id, "wamid.form");
}
{
  // flow_response may arrive as the raw JSON string.
  const j = run({ state: "none", norm: { ...formNorm, flow_response: JSON.stringify({ flow_token: "tok.str" }) } });
  assert.equal(j.tool, "create_booking_from_form");
  assert.equal(j.args.flow_token, "tok.str");
}
const createdFromForm = {
  tool: "create_booking_from_form",
  result: {
    ok: true,
    booking: { id: "bk-f1", customer_name: "Pedro Gómez", service_name: "Lavado Completo", vehicle_type: "Auto", scheduled_date: "2026-11-20", scheduled_time: "10:00", address: "Av. del Libertador 1234, Martínez", price: 54000, payment_method: "MercadoPago" },
    summary_lines: ["Lavado Completo — Auto", "Lavado Básico — SUV (20% OFF)", "Código VERANO: -$6.000"],
  },
};
{
  const j = run({ state: "form", norm: formNorm, results: [createdFromForm] });
  assert.equal(j.tool, "get_payment_link");
  assert.equal(j.args.booking_id, "bk-f1");
}
{
  const j = run({
    state: "form",
    norm: formNorm,
    results: [createdFromForm, { tool: "get_payment_link", result: { ok: true, checkout_url: "https://mpago.la/x", qr_image_url: "https://example.test/qr.png", mp_alias: "washero.mp" } }],
  });
  assert.equal(j.payload.type, "image");
  assert.equal(j.payload.image.link, "https://example.test/qr.png");
  const caption = j.payload.image.caption;
  assert.match(caption, /Listo, Pedro/);
  assert.match(caption, /20% OFF/);
  assert.match(caption, /Código VERANO/);
  assert.match(caption, /alias \*washero\.mp\*/);
  assert.match(caption, /https:\/\/mpago\.la\/x/);
  assert.match(caption, /factura/);
  assert.equal(j.next_state, "await_receipt");
  assert.equal(j.next_data.booking_id, "bk-f1");
}
{
  const j = run({
    state: "form",
    norm: formNorm,
    results: [{ tool: "create_booking_from_form", result: { ok: false, reason: "slot_unavailable" } }],
  });
  assert.equal(j.tool, "start_booking_form");
}
{
  const j = run({
    state: "form",
    norm: formNorm,
    results: [
      { tool: "create_booking_from_form", result: { ok: false, reason: "slot_unavailable" } },
      { tool: "start_booking_form", result: { ok: true, flow_id: "F", flow_token: "tok.new" } },
    ],
  });
  assert.equal(j.next_state, "form");
  assert.match(j.payload.interactive.body.text, /se ocupó ese horario/);
}
{
  // Typed text while the form is open: re-send the form with a hint.
  const j = run({
    state: "form",
    data: { misses: 0 },
    results: [{ tool: "start_booking_form", result: { ok: true, flow_id: "F", flow_token: "tok.2" } }],
    norm: { message_text: "el sábado a la mañana" },
  });
  assert.equal(j.next_state, "form");
  assert.match(j.payload.interactive.body.text, /tocá \*Reservar turno\*/);
}

// --- Satisfaction survey -------------------------------------------------------
{
  const j = run({ state: "none", norm: { message_type: "button", reply_id: "survey:good:bk-7", message_text: "¡Todo excelente!" } });
  assert.equal(j.tool, "record_survey_response");
  assert.deepEqual(j.args, { booking_id: "bk-7", rating: "positive" });
}
{
  const j = run({
    state: "handoff",
    norm: { message_type: "button", reply_id: "survey:good:bk-7", message_text: "¡Todo excelente!" },
    results: [{ tool: "record_survey_response", result: { ok: true, review_url: "https://g.page/r/washero/review" } }],
  });
  assert.equal(j.next_state, "closed");
  assert.match(j.log_text, /reseña en Google/);
  assert.match(j.log_text, /g\.page/);
}
{
  const j = run({
    state: "none",
    norm: { message_type: "button", reply_id: "survey:bad:bk-7", message_text: "Podría mejorar" },
    results: [{ tool: "record_survey_response", result: { ok: true } }],
  });
  assert.equal(j.next_state, "feedback");
  assert.equal(j.next_data.feedback_booking_id, "bk-7");
  assert.match(j.log_text, /Contanos/);
}
{
  const j = run({ state: "feedback", data: { feedback_booking_id: "bk-7" }, norm: { message_text: "Llegaron 40 minutos tarde" } });
  assert.equal(j.tool, "record_survey_response");
  assert.equal(j.args.comment, "Llegaron 40 minutos tarde");
  assert.equal(j.args.rating, "negative");
}
{
  const j = run({
    state: "feedback",
    data: { feedback_booking_id: "bk-7" },
    norm: { message_text: "Llegaron 40 minutos tarde" },
    results: [{ tool: "record_survey_response", result: { ok: true } }, { tool: "request_human_handoff", result: { ok: true } }],
  });
  assert.equal(j.next_state, "handoff");
  assert.match(j.log_text, /Gracias por contarnos/);
}

// --- Returning contact without a promo preference: notice once, no "soy el asistente" ---
{
  const j = run({ state: "closed", exists: true, pending: true, norm: { message_text: "hola" } });
  assert.equal(j.tool, "record_marketing_notice");
}
{
  const j = run({
    state: "closed",
    exists: true,
    pending: true,
    results: [{ tool: "record_marketing_notice", result: { ok: true } }],
    norm: { message_text: "hola" },
  });
  assert.equal(j.next_state, "menu");
  assert.match(j.log_text, /Agendamos tu número para avisarte de promos/);
  assert.doesNotMatch(j.log_text, /Soy el asistente/);
  assert.ok(listRowIds(j).includes("menu:nopromos"));
}
{
  // Already decided (opted in or out): no notice.
  const j = run({ state: "closed", exists: true, pending: false, norm: { message_text: "hola" } });
  assert.equal(j.action, "reply");
  assert.doesNotMatch(j.log_text, /Agendamos/);
}
{
  // Prices as the first thing they ask: notice rides along with the prices message.
  const j = run({
    state: "none",
    exists: true,
    pending: true,
    norm: { message_text: "precios" },
    results: [
      { tool: "record_marketing_notice", result: { ok: true } },
      { tool: "get_services", result: { ok: true, services: [] } },
      { tool: "list_coverage_zones", result: { ok: true, zones: ["San Isidro"] } },
    ],
  });
  assert.match(j.payload.interactive.body.text, /no promos/);
}

{
  // Silence during a human takeover happens in the n8n gate before the router ("¿Humano
  // atendiendo?"). Once it expires the router sees state 'human' and starts fresh.
  // Expired takeover: the chat starts fresh with the menu.
  const past = new Date(Date.now() - 60_000).toISOString();
  const j = run({ state: "human", data: { human_until: past }, exists: true, pending: false, norm: { message_text: "hola" } });
  assert.equal(j.next_state, "menu");
  assert.equal(j.has_message, true);
}

console.log("bot v2 (reactions, thanks, welcome, form, survey, human takeover) ok");

{
  // Texts edited in /admin/whatsapp-config arrive as bot_texts; {nombre} = first name.
  const texts = { thanks: "¡Mil gracias, {nombre}! Nos vemos.", menu_body: "Menú editado", welcome: "Buenas {nombre}, soy el bot." };
  const t = run({ state: "none", exists: true, pending: false, conv: { bot_texts: texts }, norm: { message_text: "gracias" } });
  assert.equal(t.payload.text.body, "¡Mil gracias, Pedro! Nos vemos.");
  const noName = run({ state: "none", exists: true, pending: false, conv: { bot_texts: texts }, norm: { name: "", message_text: "gracias" } });
  assert.equal(noName.payload.text.body, "¡Mil gracias! Nos vemos.");
  const m = run({ state: "none", exists: false, conv: { bot_texts: texts }, norm: { message_text: "hola" }, results: [{ tool: "record_marketing_notice", result: { ok: true } }] });
  assert.match(m.payload.interactive.body.text, /^Buenas Pedro, soy el bot\.\n\nMenú editado/);
  // Empty edited text keeps the default.
  const d = run({ state: "none", exists: true, pending: false, conv: { bot_texts: { thanks: "  " } }, norm: { message_text: "gracias" } });
  assert.match(d.payload.text.body, /^¡Gracias a vos, Pedro!/);
}

{
  // After hours (message mode): first message gets the notice, the next one is handled normally.
  const conv = { after_hours: true, after_hours_message: "Estamos cerrados." };
  const first = run({ state: "menu", data: { misses: 0 }, exists: true, pending: false, conv, norm: { message_text: "hola" } });
  assert.equal(first.payload.text.body, "Estamos cerrados.");
  assert.equal(first.next_state, "menu");
  assert.ok(first.next_data.after_hours_at);
  const second = run({ state: "menu", data: first.next_data, exists: true, pending: false, conv, norm: { message_text: "hola" } });
  assert.equal(second.next_state, "menu");
  assert.equal(second.payload.type, "interactive");
  assert.equal(second.next_data.after_hours_at, first.next_data.after_hours_at);
  // A submitted booking form is never answered with the after-hours notice.
  const form = run({ state: "form", exists: true, pending: false, conv, norm: { message_type: "interactive", flow_response: { flow_token: "t" } } });
  assert.equal(form.action, "call");
  assert.equal(form.tool, "create_booking_from_form");
}

console.log("bot settings (texts, after hours) ok");
