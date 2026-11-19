import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type FlowDeps,
  type FlowDraft,
  type FlowSession,
  draftToBookingFields,
  fmtFlowDate,
  handleBookingFlowRequest,
} from "./whatsapp-booking-flow.ts";

function fakeDeps(opts: { inside?: boolean; codeValid?: boolean; noSlots?: boolean } = {}) {
  const sessions = new Map<string, FlowSession>();
  sessions.set("wf_ok", {
    flow_token: "wf_ok",
    customer_phone: "5491122334455",
    draft: {},
    status: "open",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  sessions.set("wf_old", {
    flow_token: "wf_old",
    customer_phone: "5491122334455",
    draft: {},
    status: "open",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const calls: Record<string, unknown[]> = { checkAddress: [], slots: [], quote: [] };
  const deps: FlowDeps = {
    loadSession: (t) => Promise.resolve(sessions.has(t) ? structuredClone(sessions.get(t)!) : null),
    saveDraft: (t, draft, status) => {
      const s = sessions.get(t)!;
      s.draft = structuredClone(draft);
      if (status) s.status = status;
      return Promise.resolve();
    },
    catalog: () =>
      Promise.resolve({
        services: [
          { id: "svc-b", name: "Lavado Básico", base_price: 25000 },
          { id: "svc-c", name: "Lavado Completo", base_price: 35000, description: "Interior + exterior" },
        ],
        vehicle_types: ["Auto", "SUV", "Pick-up", "Otro"],
        extras: [{ code: "interior", name: "Aspirado profundo", amount: 5000 }],
      }),
    neighborhoods: () => Promise.resolve([{ id: "nb-1", name: "Nordelta - Los Lagos" }]),
    checkAddress: (args) => {
      calls.checkAddress.push(args);
      return Promise.resolve({
        ok: true,
        inside_coverage: opts.inside ?? true,
        formatted_address: "Av. del Libertador 1234, Martínez",
        neighborhood: "Martínez",
        coverage_zone_id: "z1",
        coverage_zone_name: "San Isidro",
        address_lat: -34.49,
        address_lng: -58.5,
        place_id: "ChIJ",
      });
    },
    slots: (units) => {
      calls.slots.push(units);
      if (opts.noSlots) return Promise.resolve({});
      return Promise.resolve({
        "2026-11-21": [{ start_time: "09:00:00", end_time: "10:30:00" }],
        "2026-11-20": [
          { start_time: "10:00", end_time: "11:30" },
          { start_time: "14:00", end_time: "15:30" },
        ],
      });
    },
    quote: (units, code) => {
      calls.quote.push({ units, code });
      if (code && !opts.codeValid) {
        return Promise.resolve({ ok: false as const, error: "invalid_discount_code", message: "Ese código está vencido." });
      }
      return Promise.resolve({
        ok: true as const,
        total: 52000,
        lines: ["Lavado Completo — Auto", "Lavado Básico — SUV (20% OFF)"],
        detail_lines: ["Lavado Completo — Auto: $35.000", "Lavado Básico — SUV: $20.000 (antes $25.000, 20% OFF)"],
      });
    },
    knownName: () => Promise.resolve("Pedro Gómez"),
    now: () => Date.now(),
  };
  return { deps, sessions, calls };
}

const ex = (token: string, data: Record<string, unknown>) => ({ action: "data_exchange", flow_token: token, data });

Deno.test("ping and error notifications", async () => {
  const { deps } = fakeDeps();
  assertEquals(await handleBookingFlowRequest({ action: "ping" }, deps), { data: { status: "active" } });
  assertEquals(
    await handleBookingFlowRequest({ action: "data_exchange", flow_token: "wf_ok", data: { error: "x" } }, deps),
    { data: { acknowledged: true } },
  );
});

Deno.test("INIT returns the first screen with catalog lists", async () => {
  const { deps } = fakeDeps();
  const r = await handleBookingFlowRequest({ action: "INIT", flow_token: "wf_ok" }, deps);
  assertEquals(r.screen, "SERVICIO");
  const services = r.data.services as Array<{ id: string; description: string }>;
  assertEquals(services.map((s) => s.id), ["svc-b", "svc-c"]);
  assert(services[1].description.includes("$35.000"));
  assertEquals(r.data.has_error, false);
});

Deno.test("expired form: first screen shows the error", async () => {
  const { deps } = fakeDeps();
  const r = await handleBookingFlowRequest({ action: "INIT", flow_token: "wf_old" }, deps);
  assertEquals(r.data.has_error, true);
  assert(String(r.data.error_text).includes("venció"));
});

Deno.test("full happy path with two vehicles, coverage, slots and summary", async () => {
  const { deps, sessions, calls } = fakeDeps({ codeValid: true });
  let r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "SERVICIO", vehicle_count: "2", vehicle_1: "Auto", service_1: "svc-c", extras_1: ["interior"] }),
    deps,
  );
  assertEquals(r.screen, "SEGUNDO_VEHICULO");

  r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "SEGUNDO_VEHICULO", vehicle_2: "SUV", service_2: "svc-b", extras_2: [] }),
    deps,
  );
  assertEquals(r.screen, "UBICACION");
  assertEquals(r.data.customer_name, "Pedro Gómez");

  r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "UBICACION", customer_name: "Pedro Gómez", address_type: "street", address: "Libertador 1234, Martínez" }),
    deps,
  );
  assertEquals(r.screen, "TURNO");
  assertEquals((r.data.dates as Array<{ id: string }>).map((d) => d.id), ["2026-11-20", "2026-11-21"]);
  assertEquals(r.data.selected_date, "2026-11-20");
  assertEquals((r.data.times as Array<{ id: string }>).map((t) => t.id), ["10:00", "14:00"]);
  // Availability is computed for both vehicles together.
  assertEquals((calls.slots[0] as unknown[]).length, 2);

  r = await handleBookingFlowRequest(ex("wf_ok", { step: "TURNO_DATE", date: "2026-11-21" }), deps);
  assertEquals(r.screen, "TURNO");
  assertEquals((r.data.times as Array<{ id: string }>).map((t) => t.id), ["09:00"]);

  r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "TURNO", date: "2026-11-20", time: "14:00", payment_method: "MercadoPago", discount_code: "verano10" }),
    deps,
  );
  assertEquals(r.screen, "RESUMEN");
  assertEquals(r.data.summary_total, "Total: $52.000");
  assert(String(r.data.summary_units).includes("20% OFF"));
  assert(String(r.data.summary_when).includes("Vie 20 nov a las 14:00"));

  const s = sessions.get("wf_ok")!;
  assertEquals(s.status, "ready");
  assertEquals(s.draft.units?.length, 2);
  assertEquals(s.draft.units?.[0].extras, ["interior"]);
  assertEquals(s.draft.discount_code, "verano10");
  assertEquals(s.draft.coverage_zone_id, "z1");

  const fields = draftToBookingFields(s.draft);
  assert(fields.ok);
  if (fields.ok) {
    assertEquals(fields.fields.service_id, "svc-c");
    assertEquals((fields.fields.booking_units as unknown[]).length, 2);
    assertEquals(fields.fields.discount_code, "verano10");
    assertEquals(fields.fields.scheduled_time, "14:00");
    assertEquals(fields.fields.payment_method, "MercadoPago");
  }
});

Deno.test("one vehicle skips SEGUNDO_VEHICULO and drops a previous second vehicle", async () => {
  const { deps, sessions } = fakeDeps();
  sessions.get("wf_ok")!.draft = { units: [{ vehicle_type: "Auto", service_id: "svc-b", service_name: "x", extras: [] }, { vehicle_type: "SUV", service_id: "svc-b", service_name: "x", extras: [] }] };
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "SERVICIO", vehicle_count: "1", vehicle_1: "Auto", service_1: "svc-b" }),
    deps,
  );
  assertEquals(r.screen, "UBICACION");
  assertEquals(sessions.get("wf_ok")!.draft.units?.length, 1);
});

Deno.test("validation errors stay on the same screen", async () => {
  const { deps } = fakeDeps();
  let r = await handleBookingFlowRequest(ex("wf_ok", { step: "SERVICIO", vehicle_count: "1", vehicle_1: "Auto", service_1: "nope" }), deps);
  assertEquals(r.screen, "SERVICIO");
  assertEquals(r.data.has_error, true);

  r = await handleBookingFlowRequest(ex("wf_ok", { step: "UBICACION", customer_name: "P", address_type: "street", address: "x" }), deps);
  assertEquals(r.screen, "UBICACION");
  assert(String(r.data.error_text).includes("nombre"));

  r = await handleBookingFlowRequest(ex("wf_ok", { step: "UBICACION", customer_name: "Pedro", address_type: "private", private_neighborhood: "nb-1" }), deps);
  assertEquals(r.screen, "UBICACION");
  assert(String(r.data.error_text).includes("lote"));
});

Deno.test("outside coverage shows the error on UBICACION", async () => {
  const { deps } = fakeDeps({ inside: false });
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "UBICACION", customer_name: "Pedro", address_type: "street", address: "San Martín 100, Rosario" }),
    deps,
  );
  assertEquals(r.screen, "UBICACION");
  assert(String(r.data.error_text).includes("no llegamos"));
});

Deno.test("gated neighborhood is validated by id", async () => {
  const { deps, calls, sessions } = fakeDeps();
  sessions.get("wf_ok")!.draft = { units: [{ vehicle_type: "Auto", service_id: "svc-b", service_name: "x", extras: [] }] };
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "UBICACION", customer_name: "Pedro", address_type: "private", private_neighborhood: "nb-1", private_lot: "Lote 45" }),
    deps,
  );
  assertEquals(r.screen, "TURNO");
  assertEquals((calls.checkAddress[0] as Record<string, unknown>).private_neighborhood_id, "nb-1");
  assertEquals(sessions.get("wf_ok")!.draft.private_lot, "Lote 45");
});

Deno.test("invalid discount code keeps the customer on TURNO with the reason", async () => {
  const { deps, sessions } = fakeDeps({ codeValid: false });
  sessions.get("wf_ok")!.draft = {
    units: [{ vehicle_type: "Auto", service_id: "svc-b", service_name: "x", extras: [] }],
    address: "X",
    formatted_address: "X",
  } as FlowDraft;
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "TURNO", date: "2026-11-20", time: "10:00", payment_method: "Transferencia", discount_code: "VIEJO" }),
    deps,
  );
  assertEquals(r.screen, "TURNO");
  assert(String(r.data.error_text).includes("vencido"));
  assertEquals(sessions.get("wf_ok")!.status, "open");
});

Deno.test("a slot that is no longer available is rejected", async () => {
  const { deps, sessions } = fakeDeps();
  sessions.get("wf_ok")!.draft = { units: [{ vehicle_type: "Auto", service_id: "svc-b", service_name: "x", extras: [] }] };
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "TURNO", date: "2026-11-20", time: "18:00", payment_method: "MercadoPago" }),
    deps,
  );
  assertEquals(r.screen, "TURNO");
  assertEquals(r.data.has_error, true);
});

Deno.test("no availability at all: tell them on UBICACION", async () => {
  const { deps, sessions } = fakeDeps({ noSlots: true });
  sessions.get("wf_ok")!.draft = { units: [{ vehicle_type: "Auto", service_id: "svc-b", service_name: "x", extras: [] }] };
  const r = await handleBookingFlowRequest(
    ex("wf_ok", { step: "UBICACION", customer_name: "Pedro", address_type: "street", address: "Libertador 1234" }),
    deps,
  );
  assertEquals(r.screen, "UBICACION");
  assert(String(r.data.error_text).includes("No quedan turnos"));
});

Deno.test("draftToBookingFields reports what is missing", () => {
  const r = draftToBookingFields({ units: [] });
  assertEquals(r.ok, false);
});

Deno.test("fmtFlowDate", () => {
  assertEquals(fmtFlowDate("2026-11-20"), "Vie 20 nov");
});
