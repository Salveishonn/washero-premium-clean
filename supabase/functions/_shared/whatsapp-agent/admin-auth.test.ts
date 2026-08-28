// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/admin-auth.test.ts
//
// Only "(1) missing JWT" is testable without a live Supabase auth session — it's the one case
// that returns before any network call at all. Scenarios (2) invalid JWT, (3) authenticated
// non-admin, (4) inactive admin, (5) active operator, and (6) active owner|admin all require a
// real Supabase project with real fixtures. Those are NOT silently claimed to pass.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isOwnerOrAdminRole, requireActiveAdmin } from "./admin-auth.ts";

const unreachableAdmin = new Proxy(
  {},
  {
    get() {
      throw new Error("admin client should not be touched when there is no auth header at all");
    },
  },
) as unknown as SupabaseClient;

Deno.test(
  "(1) missing JWT: rejected immediately, no DB or auth network call attempted",
  async () => {
    const result = await requireActiveAdmin(unreachableAdmin, {
      supabaseUrl: "https://example.invalid",
      anonKey: "anon-key-not-used",
      authHeader: null,
    });
    assertEquals(result, null);
  },
);

Deno.test("(1b) empty-string JWT is also rejected immediately", async () => {
  const result = await requireActiveAdmin(unreachableAdmin, {
    supabaseUrl: "https://example.invalid",
    anonKey: "anon-key-not-used",
    authHeader: "",
  });
  assertEquals(result, null);
});

Deno.test("owner|admin roles pass the gate; operator and unknown roles do not", () => {
  assertEquals(isOwnerOrAdminRole("owner"), true);
  assertEquals(isOwnerOrAdminRole("admin"), true);
  assertEquals(isOwnerOrAdminRole("operator"), false);
  assertEquals(isOwnerOrAdminRole("staff"), false);
  assertEquals(isOwnerOrAdminRole(null), false);
  assertEquals(isOwnerOrAdminRole(""), false);
});
