// Worker-secret authentication for whatsapp-agent-worker (production-hardening audit — "worker
// authentication and scheduling"). Extracted so it's directly unit-testable — see
// worker-auth.test.ts.
//
// Not a Supabase JWT: pg_cron's net.http_post (and most external cron services) can't easily mint
// one, and the worker doesn't need user-level authorization, only "is this call coming from our
// own scheduler" — a shared secret, stored as an Edge Function secret (or read into the cron job
// from Supabase Vault, never hardcoded — see supabase/optional/whatsapp_agent_worker_schedule.sql)
// is the right tool here, not JWT auth. An ordinary authenticated user's JWT grants nothing.

/** Constant-time-ish comparison: hashes both inputs to a fixed-length digest first (so a
 * differing input length doesn't itself leak anything via early-exit branching on `!==`), then
 * compares every byte of both digests unconditionally. Practical within what Deno's Web Crypto
 * offers here — not a claim of formal side-channel-proof security. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

/**
 * Validates the worker's shared-secret header. Fails closed: an unconfigured secret (empty
 * string, e.g. the env var was never set) always rejects, regardless of what the caller sends —
 * this must never be treated as "auth disabled".
 */
export async function isValidWorkerSecret(
  providedSecret: string | null,
  configuredSecret: string,
): Promise<boolean> {
  if (!configuredSecret) return false;
  if (!providedSecret) return false;
  return await timingSafeEqual(providedSecret, configuredSecret);
}

/** Accept any of several configured secrets (n8n inbound vs existing Botmaker). */
export async function isValidAnyWorkerSecret(
  providedSecret: string | null,
  configuredSecrets: readonly string[],
): Promise<boolean> {
  const secrets = configuredSecrets.map((s) => s.trim()).filter(Boolean);
  if (!providedSecret || secrets.length === 0) return false;
  const matches = await Promise.all(
    secrets.map((secret) => isValidWorkerSecret(providedSecret, secret)),
  );
  return matches.some(Boolean);
}
