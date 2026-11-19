// WhatsApp Flows endpoint encryption (Meta "data_api_version" 3.0).
//
// Request:  { encrypted_aes_key, encrypted_flow_data, initial_vector } (all base64)
//   - encrypted_aes_key: 128-bit AES key encrypted with our RSA public key (RSA-OAEP, SHA-256)
//   - encrypted_flow_data: AES-128-GCM ciphertext with the 16-byte auth tag appended
// Response: base64(AES-GCM(json)) with the SAME key and the IV with every byte inverted.
// Plain WebCrypto, no dependencies. The private key must be unencrypted PKCS#8 PEM.

export type EncryptedFlowRequest = {
  encrypted_aes_key?: string;
  encrypted_flow_data?: string;
  initial_vector?: string;
};

export type DecryptedFlowRequest = {
  payload: Record<string, unknown>;
  aesKey: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
};

export class FlowDecryptError extends Error {}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return base64ToBytes(body);
}

export async function importFlowPrivateKey(pem: string): Promise<CryptoKey> {
  if (/ENCRYPTED PRIVATE KEY/.test(pem)) {
    throw new Error("WA_FLOW_PRIVATE_KEY must be an unencrypted PKCS#8 key");
  }
  return await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

export async function decryptFlowRequest(
  body: EncryptedFlowRequest,
  privateKey: CryptoKey,
): Promise<DecryptedFlowRequest> {
  if (!body?.encrypted_aes_key || !body.encrypted_flow_data || !body.initial_vector) {
    throw new FlowDecryptError("missing_fields");
  }
  let rawKey: ArrayBuffer;
  try {
    rawKey = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      base64ToBytes(body.encrypted_aes_key),
    );
  } catch {
    throw new FlowDecryptError("aes_key_decrypt_failed");
  }
  const aesKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = base64ToBytes(body.initial_vector);
  let clear: ArrayBuffer;
  try {
    clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      aesKey,
      base64ToBytes(body.encrypted_flow_data),
    );
  } catch {
    throw new FlowDecryptError("flow_data_decrypt_failed");
  }
  const payload = JSON.parse(new TextDecoder().decode(clear));
  return { payload, aesKey, iv };
}

export function flipIv(iv: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) out[i] = ~iv[i] & 0xff;
  return out;
}

export async function encryptFlowResponse(
  response: unknown,
  aesKey: CryptoKey,
  iv: Uint8Array,
): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(response));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: flipIv(iv), tagLength: 128 },
    aesKey,
    data,
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

/** Meta signs endpoint requests with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export async function isValidMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret) return true; // not configured: rely on the encryption alone
  const sig = String(header ?? "").replace(/^sha256=/, "").trim().toLowerCase();
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
