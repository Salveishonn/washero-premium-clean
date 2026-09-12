#!/usr/bin/env node
/**
 * Authenticated production smokes for the WhatsApp booking tools.
 * Does not log the secret. Requires WHATSAPP_TOOLS_SECRET.
 *
 *   WHATSAPP_TOOLS_SECRET=... node scripts/whatsapp-tools-prod-smoke.mjs
 */
const URL = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-tools";
const SECRET = (process.env.WHATSAPP_TOOLS_SECRET || "").trim();
const PHONE = process.env.WHATSAPP_SMOKE_PHONE || "5491100000001";
const CONV = process.env.WHATSAPP_SMOKE_CONVERSATION || "smoke-booking-bot";

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
      customer_name: "Smoke",
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

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

const report = { url: URL, phone: PHONE, cases: [] };

{
  const r = await call("suggest_addresses", { query: "Libertador 1500 Martinez" });
  const suggestions = r.body?.suggestions || [];
  report.cases.push({
    name: "suggest_addresses Martinez",
    status: r.status,
    ok: r.body?.ok === true,
    error: r.body?.error || null,
    google_status: r.body?.google_status || null,
    suggestion_count: suggestions.length,
    sample: suggestions.slice(0, 2).map((s) => pick(s, ["place_id", "description"])),
  });
}

{
  const r = await call("validate_service_area", {
    address: "Avenida del Libertador 1500, Martinez, Buenos Aires",
    address_type: "street",
  });
  report.cases.push({
    name: "validate_service_area Martinez",
    status: r.status,
    ok: r.body?.ok === true,
    inside_coverage: r.body?.inside_coverage ?? null,
    coverage_zone_name: r.body?.coverage_zone_name ?? null,
    formatted_address: r.body?.formatted_address ?? null,
    has_coords: r.body?.address_lat != null && r.body?.address_lng != null,
  });
}

{
  const r = await call("validate_service_area", {
    address: "Avenida de los Lagos 1602, Nordelta, Tigre",
    address_type: "street",
  });
  report.cases.push({
    name: "validate_service_area Nordelta inside",
    status: r.status,
    ok: r.body?.ok === true && r.body?.inside_coverage === true,
    inside_coverage: r.body?.inside_coverage ?? null,
    coverage_zone_name: r.body?.coverage_zone_name ?? null,
    formatted_address: r.body?.formatted_address ?? null,
    has_coords: r.body?.address_lat != null && r.body?.address_lng != null,
  });
}

{
  const r = await call("validate_service_area", {
    address: "Calle Florida 100, Ciudad Autonoma de Buenos Aires",
    address_type: "street",
  });
  report.cases.push({
    name: "validate_service_area CABA outside",
    status: r.status,
    ok: r.body?.ok === true,
    inside_coverage: r.body?.inside_coverage ?? null,
    coverage_zone_name: r.body?.coverage_zone_name ?? null,
    formatted_address: r.body?.formatted_address ?? null,
  });
}

{
  const r = await call("get_bank_transfer_details", {});
  report.cases.push({
    name: "get_bank_transfer_details",
    status: r.status,
    ok: r.body?.ok === true,
    error: r.body?.error || null,
    has_alias: Boolean(r.body?.alias),
    has_cbu: Boolean(r.body?.cbu),
    has_holder: Boolean(r.body?.holder),
    has_bank: Boolean(r.body?.bank),
    has_customer_message: Boolean(r.body?.customer_message),
  });
}

{
  const r = await call("list_coverage_zones", {});
  report.cases.push({
    name: "list_coverage_zones",
    status: r.status,
    ok: r.body?.ok === true,
    zone_count: (r.body?.zones || []).length,
    private_count: (r.body?.private_neighborhood_list || []).length,
  });
}

{
  const r = await call("get_services", {});
  report.cases.push({
    name: "get_services",
    status: r.status,
    ok: r.body?.ok === true,
    service_count: (r.body?.services || []).length,
    has_vehicles: Array.isArray(r.body?.vehicles),
    has_extras: Array.isArray(r.body?.extras),
    payment_methods: r.body?.payment_methods || null,
  });
}

const failed = report.cases.filter((c) => c.status !== 200 || c.ok === false);
report.failed = failed.map((c) => c.name);
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
