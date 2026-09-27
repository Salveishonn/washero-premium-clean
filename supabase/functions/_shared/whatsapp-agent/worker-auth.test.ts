// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/worker-auth.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidAnyWorkerSecret, isValidWorkerSecret } from "./worker-auth.ts";

const REAL_SECRET = "a-real-worker-secret-value-1234567890";

Deno.test(
  "(1) missing configured secret (env var unset/empty): always rejects, even a correct-looking guess",
  async () => {
    assertEquals(await isValidWorkerSecret(REAL_SECRET, ""), false);
  },
);

Deno.test("(1b) missing provided secret (no header sent): rejected", async () => {
  assertEquals(await isValidWorkerSecret(null, REAL_SECRET), false);
});

Deno.test("(2) incorrect worker secret: rejected", async () => {
  assertEquals(await isValidWorkerSecret("totally-wrong-value", REAL_SECRET), false);
});

Deno.test(
  "(2b) incorrect worker secret that merely shares a prefix: still rejected (proves no naive startsWith check)",
  async () => {
    assertEquals(await isValidWorkerSecret(REAL_SECRET.slice(0, -1), REAL_SECRET), false);
  },
);

Deno.test("(3) correct worker secret: accepted", async () => {
  assertEquals(await isValidWorkerSecret(REAL_SECRET, REAL_SECRET), true);
});

Deno.test("(4) an ordinary JWT-shaped string is not treated as the worker secret", async () => {
  const fakeJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.fakefakefakefakefakefake";
  assertEquals(await isValidWorkerSecret(fakeJwt, REAL_SECRET), false);
});

Deno.test("isValidAnyWorkerSecret accepts the n8n secret when Botmaker also exists", async () => {
  assertEquals(
    await isValidAnyWorkerSecret("n8n-inbound-secret", ["botmaker-old-secret", "n8n-inbound-secret"]),
    true,
  );
});

Deno.test("isValidAnyWorkerSecret still rejects when none of the configured secrets match", async () => {
  assertEquals(
    await isValidAnyWorkerSecret("nope", ["botmaker-old-secret", "n8n-inbound-secret"]),
    false,
  );
});

Deno.test("isValidAnyWorkerSecret fails closed when no secrets are configured", async () => {
  assertEquals(await isValidAnyWorkerSecret("n8n-inbound-secret", ["", "  "]), false);
});
