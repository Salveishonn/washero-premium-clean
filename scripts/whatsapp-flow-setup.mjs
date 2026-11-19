#!/usr/bin/env node
/**
 * One-time setup of the WhatsApp booking form (WhatsApp Flow with endpoint).
 *
 * Env (never commit them): WA_TOKEN (system user token with whatsapp_business_management +
 * whatsapp_business_messaging), WABA_ID, PHONE_NUMBER_ID, FLOW_ID (after `create`).
 *
 *   node scripts/whatsapp-flow-setup.mjs keys         # dist/wa-flow-private.pem + public.pem
 *   node scripts/whatsapp-flow-setup.mjs upload-key   # public key → phone number
 *   node scripts/whatsapp-flow-setup.mjs create       # creates the Flow (draft), prints FLOW_ID
 *   node scripts/whatsapp-flow-setup.mjs update       # re-uploads whatsapp-booking-flow.json
 *   node scripts/whatsapp-flow-setup.mjs status       # validation errors / status / health
 *   node scripts/whatsapp-flow-setup.mjs publish      # publish (irreversible for that version)
 *
 * The private key goes to Supabase: supabase secrets set WA_FLOW_PRIVATE_KEY="$(cat dist/wa-flow-private.pem)"
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRAPH = "https://graph.facebook.com/v20.0";
const FLOW_JSON = join(root, "supabase/functions/_shared/whatsapp-booking-flow.json");
const ENDPOINT = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-booking-flow";

function env(name) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.error(`Falta la variable de entorno ${name}`);
    process.exit(1);
  }
  return v;
}

async function graph(path, init = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

const cmd = process.argv[2];

if (cmd === "keys") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/wa-flow-private.pem"), privateKey, { mode: 0o600 });
  writeFileSync(join(root, "dist/wa-flow-public.pem"), publicKey);
  console.log("Listo: dist/wa-flow-private.pem (secreto, NO commitear) y dist/wa-flow-public.pem");
} else if (cmd === "upload-key") {
  const publicKey = readFileSync(join(root, "dist/wa-flow-public.pem"), "utf8");
  const body = new URLSearchParams({ business_public_key: publicKey });
  console.log(await graph(`/${env("PHONE_NUMBER_ID")}/whatsapp_business_encryption`, { method: "POST", body }));
} else if (cmd === "create") {
  const out = await graph(`/${env("WABA_ID")}/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "washero_reserva_v1",
      categories: ["APPOINTMENT_BOOKING"],
      flow_json: readFileSync(FLOW_JSON, "utf8"),
      endpoint_uri: ENDPOINT,
    }),
  });
  console.log(JSON.stringify(out, null, 2));
  console.log("\nGuardá el id como secreto: supabase secrets set WA_BOOKING_FLOW_ID=<id> WA_BOOKING_FLOW_MODE=draft");
} else if (cmd === "update") {
  const form = new FormData();
  form.append("name", "flow.json");
  form.append("asset_type", "FLOW_JSON");
  form.append("file", new Blob([readFileSync(FLOW_JSON)], { type: "application/json" }), "flow.json");
  console.log(JSON.stringify(await graph(`/${env("FLOW_ID")}/assets`, { method: "POST", body: form }), null, 2));
} else if (cmd === "status") {
  console.log(JSON.stringify(
    await graph(`/${env("FLOW_ID")}?fields=name,status,validation_errors,endpoint_uri,preview.invalidate(false),health_status`),
    null,
    2,
  ));
} else if (cmd === "publish") {
  console.log(await graph(`/${env("FLOW_ID")}/publish`, { method: "POST" }));
  console.log("Publicado. Cambiá el secreto: supabase secrets set WA_BOOKING_FLOW_MODE=published");
} else {
  console.log("Uso: node scripts/whatsapp-flow-setup.mjs keys|upload-key|create|update|status|publish");
}
