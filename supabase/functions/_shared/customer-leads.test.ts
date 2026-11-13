import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  captureLead,
  deriveInboundLeadSignals,
  deriveToolLeadSignal,
  ensureLeadCustomer,
  recordLeadSignals,
} from "./customer-leads.ts";

const signals = (hits: { signal: string }[]) => hits.map((h) => h.signal).sort();

Deno.test("every inbound message is at least a contacto", () => {
  assertEquals(signals(deriveInboundLeadSignals({ messageText: "hola" })), ["contacto"]);
  assertEquals(signals(deriveInboundLeadSignals({ messageText: null })), ["contacto"]);
});

Deno.test("menu taps map to interest by reply id or by tapped title", () => {
  assertEquals(
    signals(deriveInboundLeadSignals({ messageText: "Precios", replyId: "menu:servicios" })),
    ["contacto", "precios"],
  );
  // Normalize Inbound sends the list row title as message_text; reply_id may not reach ingest.
  assertEquals(signals(deriveInboundLeadSignals({ messageText: "Cobertura" })), ["cobertura", "contacto"]);
  assertEquals(signals(deriveInboundLeadSignals({ messageText: "Reservar" })), ["contacto", "reserva_iniciada"]);
  assertEquals(signals(deriveInboundLeadSignals({ messageText: "x", replyId: "nav:humano" })), ["contacto", "pidio_humano"]);
});

Deno.test("free text keywords add price and coverage interest", () => {
  assertEquals(
    signals(deriveInboundLeadSignals({ messageText: "Hola! cuánto sale el lavado? llegan a Tigre?" })),
    ["cobertura", "contacto", "precios"],
  );
  assertEquals(signals(deriveInboundLeadSignals({ messageText: "quiero cambiar mi reserva" })), ["contacto"]);
});

Deno.test("keywords are ignored when the message is a button tap", () => {
  assertEquals(
    signals(deriveInboundLeadSignals({ messageText: "precio especial", replyId: "svc:abc" })),
    ["contacto"],
  );
});

Deno.test("tool results: outside coverage and quotes are leads, the rest is not", () => {
  assertEquals(
    deriveToolLeadSignal("validate_service_area", { address: "Pilar 123" }, { ok: true, inside_coverage: false }),
    { signal: "fuera_de_cobertura", detail: { ultima_consulta: "Pilar 123" } },
  );
  assertEquals(
    deriveToolLeadSignal("validate_service_area", {}, { ok: true, inside_coverage: true }),
    null,
  );
  assertEquals(
    deriveToolLeadSignal("calculate_booking_price", { service_id: "s1", vehicle_type: "SUV" }, { ok: true, total_amount: 30000 }),
    { signal: "cotizacion", detail: { service_id: "s1", vehicle_type: "SUV", total_amount: 30000 } },
  );
  assertEquals(deriveToolLeadSignal("calculate_booking_price", {}, { ok: false }), null);
  assertEquals(deriveToolLeadSignal("get_services", {}, { ok: true }), null);
});

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for the supabase-js query builder used here.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function fakeAdmin(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { customers: [], customer_lead_signals: [], ...seed };
  let nextId = 1;
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let insertRow: Row | null = null;
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === "update") {
        for (const r of rows()) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (op === "insert" && insertRow) {
        const defaults: Row = table === "customer_lead_signals" ? { hits: 1 } : {};
        const created = { id: `id-${nextId++}`, created_at: new Date().toISOString(), ...defaults, ...insertRow };
        tables[table].push(created);
        return { data: created, error: null };
      }
      return { data: rows(), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      in: (col: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return api;
      },
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return api;
      },
      order: () => api,
      limit: () => api,
      update: (p: Row) => {
        op = "update";
        patch = p;
        return api;
      },
      insert: (r: Row) => {
        op = "insert";
        insertRow = r;
        return api;
      },
      maybeSingle: () => {
        const res = run();
        const data = Array.isArray(res.data) ? res.data[0] ?? null : res.data;
        return Promise.resolve({ data, error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return api;
  }
  return { tables, admin: { from: builder } as unknown as SupabaseClient };
}

Deno.test("ensureLeadCustomer creates a lead with the display phone and source", async () => {
  const { tables, admin } = fakeAdmin();
  const id = await ensureLeadCustomer(admin, { phone: "5491155556666", name: "Ana", touchContact: true });
  assertEquals(typeof id, "string");
  assertEquals(tables.customers.length, 1);
  assertEquals(tables.customers[0].full_name, "Ana");
  assertEquals(tables.customers[0].phone, "+54 9 11 5555-6666");
  assertEquals(tables.customers[0].source, "whatsapp_bot");
});

Deno.test("ensureLeadCustomer keeps existing customers and only refreshes contact time", async () => {
  const { tables, admin } = fakeAdmin({
    customers: [{ id: "c1", full_name: "Cliente Real", phone: "+54 9 11 5555-6666", first_contact_at: null }],
  });
  const id = await ensureLeadCustomer(admin, { phone: "5491155556666", name: "otro nombre", touchContact: true });
  assertEquals(id, "c1");
  assertEquals(tables.customers.length, 1);
  assertEquals(tables.customers[0].full_name, "Cliente Real");
  assertEquals(typeof tables.customers[0].last_contact_at, "string");
  assertEquals(typeof tables.customers[0].first_contact_at, "string");
});

Deno.test("ensureLeadCustomer ignores phones that are not Argentine mobiles", async () => {
  const { tables, admin } = fakeAdmin();
  assertEquals(await ensureLeadCustomer(admin, { phone: "123", name: null, touchContact: true }), null);
  assertEquals(tables.customers.length, 0);
});

Deno.test("recordLeadSignals inserts once and then counts hits", async () => {
  const { tables, admin } = fakeAdmin();
  await recordLeadSignals(admin, "c1", [{ signal: "precios" }]);
  await recordLeadSignals(admin, "c1", [{ signal: "precios" }, { signal: "cobertura" }]);
  const precios = tables.customer_lead_signals.find((r) => r.signal === "precios");
  assertEquals(precios?.hits, 2);
  assertEquals(tables.customer_lead_signals.length, 2);
});

Deno.test("captureLead records consent from the promo quick replies", async () => {
  const { tables, admin } = fakeAdmin({ customer_communication_preferences: [] });
  await captureLead(admin, {
    phone: "5491155556666",
    name: "Ana",
    touchContact: true,
    hits: [{ signal: "contacto" }],
    consentReplyText: "Sí, quiero promos",
  });
  const prefs = tables.customer_communication_preferences;
  assertEquals(prefs.length, 1);
  assertEquals(prefs[0].status, "opted_in");
  assertEquals(prefs[0].source, "whatsapp_reply");
  const optedInAt = prefs[0].opted_in_at;

  await captureLead(admin, {
    phone: "5491155556666",
    name: "Ana",
    touchContact: true,
    hits: [{ signal: "contacto" }],
    consentReplyText: "No recibir promos",
  });
  assertEquals(prefs.length, 1);
  assertEquals(prefs[0].status, "opted_out");
  assertEquals(prefs[0].opted_in_at, optedInAt);
});

Deno.test("captureLead never throws into the bot flow", async () => {
  const broken = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
  await captureLead(broken, { phone: "5491155556666", name: null, hits: [{ signal: "contacto" }], touchContact: true });
});
