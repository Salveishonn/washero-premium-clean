// Edge Function: whatsapp-booking-flow
// Data endpoint of the WhatsApp booking form (WhatsApp Flows, data_api_version 3.0).
// Meta calls it on every "Continuar" / date change with an encrypted body; we answer the
// next screen encrypted with the same AES key. Deploy with verify_jwt = false.
//
// Secrets:
//   WA_FLOW_PRIVATE_KEY  unencrypted PKCS#8 PEM (its public key is uploaded to the phone number)
//   WA_APP_SECRET        optional, Meta app secret to verify X-Hub-Signature-256
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  FlowDecryptError,
  decryptFlowRequest,
  encryptFlowResponse,
  importFlowPrivateKey,
  isValidMetaSignature,
} from "../_shared/whatsapp-flow-crypto.ts";
import { handleBookingFlowRequest } from "../_shared/whatsapp-booking-flow.ts";
import { realFlowDeps } from "../_shared/whatsapp-bot-v2-tools.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const deps = realFlowDeps(admin);

let privateKeyPromise: Promise<CryptoKey> | null = null;
function privateKey(): Promise<CryptoKey> {
  if (!privateKeyPromise) {
    const pem = Deno.env.get("WA_FLOW_PRIVATE_KEY") ?? "";
    privateKeyPromise = importFlowPrivateKey(pem);
  }
  return privateKeyPromise;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();

  const appSecret = (Deno.env.get("WA_APP_SECRET") ?? "").trim();
  if (!(await isValidMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) {
    return new Response("invalid signature", { status: 432 });
  }

  let decrypted;
  try {
    decrypted = await decryptFlowRequest(JSON.parse(raw), await privateKey());
  } catch (e) {
    // 421 tells WhatsApp to re-download the public key and retry.
    const status = e instanceof FlowDecryptError ? 421 : 500;
    console.error("[whatsapp-booking-flow] decrypt failed", e instanceof Error ? e.message : e);
    return new Response("decryption failed", { status });
  }

  let response;
  try {
    response = await handleBookingFlowRequest(decrypted.payload, deps);
  } catch (e) {
    console.error("[whatsapp-booking-flow] handler failed", e instanceof Error ? e.stack : e);
    response = {
      screen: "SERVICIO",
      data: {
        services: [],
        vehicle_types: [],
        extras: [],
        has_error: true,
        error_text: "Tuvimos un problema. Cerrá el formulario y escribí *humano* en el chat.",
      },
    };
  }
  const body = await encryptFlowResponse(response, decrypted.aesKey, decrypted.iv);
  return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });
});
