import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FlowDecryptError,
  base64ToBytes,
  bytesToBase64,
  decryptFlowRequest,
  encryptFlowResponse,
  flipIv,
  importFlowPrivateKey,
  isValidMetaSignature,
} from "./whatsapp-flow-crypto.ts";

async function keyPairPem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = bytesToBase64(pkcs8).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

/** Encrypt a request exactly like WhatsApp does. */
async function metaEncrypt(publicKey: CryptoKey, payload: unknown) {
  const aesRaw = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey("raw", aesRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(JSON.stringify(payload))),
  );
  const encKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, aesRaw));
  return {
    body: {
      encrypted_aes_key: bytesToBase64(encKey),
      encrypted_flow_data: bytesToBase64(data),
      initial_vector: bytesToBase64(iv),
    },
    aesKey,
    iv,
  };
}

Deno.test("decrypts a Meta-style request and encrypts the response with the flipped IV", async () => {
  const { pem, publicKey } = await keyPairPem();
  const key = await importFlowPrivateKey(pem);
  const request = { version: "3.0", action: "INIT", flow_token: "wf_abc" };
  const { body, aesKey, iv } = await metaEncrypt(publicKey, request);

  const decrypted = await decryptFlowRequest(body, key);
  assertEquals(decrypted.payload, request);

  const response = { screen: "SERVICIO", data: { has_error: false } };
  const encrypted = await encryptFlowResponse(response, decrypted.aesKey, decrypted.iv);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: flipIv(iv) }, aesKey, base64ToBytes(encrypted));
  assertEquals(JSON.parse(new TextDecoder().decode(clear)), response);
});

Deno.test("accepts a PEM pasted with literal \\n sequences", async () => {
  const { pem, publicKey } = await keyPairPem();
  const key = await importFlowPrivateKey(pem.replace(/\n/g, "\\n"));
  const { body } = await metaEncrypt(publicKey, { action: "ping" });
  assertEquals((await decryptFlowRequest(body, key)).payload, { action: "ping" });
});

Deno.test("a request encrypted for another key fails with FlowDecryptError (→ HTTP 421)", async () => {
  const mine = await keyPairPem();
  const other = await keyPairPem();
  const { body } = await metaEncrypt(other.publicKey, { action: "ping" });
  await assertRejects(() => decryptFlowRequest(body, Promise.resolve(null as never) as never), Error);
  await assertRejects(async () => decryptFlowRequest(body, await importFlowPrivateKey(mine.pem)), FlowDecryptError);
});

Deno.test("flipIv inverts every byte", () => {
  assertEquals([...flipIv(new Uint8Array([0, 255, 15]))], [255, 0, 240]);
});

Deno.test("Meta signature check", async () => {
  const secret = "app-secret";
  const body = '{"a":1}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await isValidMetaSignature(body, `sha256=${hex}`, secret), true);
  assertEquals(await isValidMetaSignature(body, "sha256=00", secret), false);
  assertEquals(await isValidMetaSignature(body, null, ""), true);
});
