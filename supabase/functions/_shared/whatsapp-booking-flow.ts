// Screen logic of the WhatsApp booking form (WhatsApp Flow with endpoint).
//
// Pure function of (decrypted request, injected deps) → Flow response, so it is unit-tested
// without Meta or the database. The edge function whatsapp-booking-flow wires the real deps
// (catalog, coverage, availability, pricing, discount codes) — the same shared logic the
// website /reservar uses — and handles the encryption.
//
// Screens (see whatsapp-booking-flow.json):
//   SERVICIO   vehicle 1 + service + extras + how many vehicles (1 or 2, 2nd with 20% OFF)
//   SEGUNDO_VEHICULO only when 2 vehicles
//   UBICACION  name + street address or gated neighborhood (coverage checked here)
//   TURNO      day + time (real availability for the total duration) + payment + coupon
//   RESUMEN    exact total; "Confirmar reserva" completes the flow → nfm_reply in the chat,
//              where the n8n router calls create_booking_from_form with the flow_token.

export const FLOW_SCREENS = ["SERVICIO", "SEGUNDO_VEHICULO", "UBICACION", "TURNO", "RESUMEN"] as const;
export type FlowScreen = (typeof FLOW_SCREENS)[number];

export const FLOW_PAYMENT_METHODS = ["MercadoPago", "Transferencia", "Pagar después"] as const;

export type FlowUnit = {
  vehicle_type: string;
  service_id: string;
  service_name: string;
  extras: string[];
};

export type FlowDraft = {
  customer_name?: string;
  vehicle_count?: number;
  units?: FlowUnit[];
  address_type?: "street" | "private_neighborhood";
  address_input?: string;
  address?: string;
  formatted_address?: string;
  neighborhood?: string;
  place_id?: string;
  address_lat?: number | null;
  address_lng?: number | null;
  coverage_zone_id?: string;
  coverage_zone_name?: string;
  private_neighborhood_id?: string;
  private_neighborhood_name?: string;
  private_lot?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  payment_method?: string;
  discount_code?: string;
  total?: number;
  summary_lines?: string[];
};

export type FlowSession = {
  flow_token: string;
  customer_phone: string;
  draft: FlowDraft;
  status: string;
  expires_at: string;
};

export type FlowCatalog = {
  services: Array<{ id: string; name: string; base_price: number; description?: string | null }>;
  vehicle_types: string[];
  extras: Array<{ code: string; name: string; amount: number }>;
};

export type FlowAddressCheck = {
  ok: boolean;
  inside_coverage?: boolean;
  formatted_address?: string | null;
  neighborhood?: string | null;
  coverage_zone_id?: string | null;
  coverage_zone_name?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  place_id?: string | null;
  private_neighborhood_id?: string | null;
  private_neighborhood_name?: string | null;
};

export type FlowSlotMap = Record<string, Array<{ start_time: string; end_time: string }>>;

export type FlowQuote =
  | { ok: true; total: number; lines: string[]; detail_lines: string[] }
  | { ok: false; error: string; message?: string };

export type FlowDeps = {
  loadSession(token: string): Promise<FlowSession | null>;
  saveDraft(token: string, draft: FlowDraft, status?: "open" | "ready"): Promise<void>;
  catalog(): Promise<FlowCatalog>;
  neighborhoods(): Promise<Array<{ id: string; name: string }>>;
  checkAddress(args: Record<string, unknown>, phone: string): Promise<FlowAddressCheck>;
  slots(units: FlowUnit[]): Promise<FlowSlotMap | null>;
  quote(units: FlowUnit[], discountCode: string): Promise<FlowQuote>;
  knownName(phone: string): Promise<string>;
  now(): number;
};

export type FlowRequest = {
  version?: string;
  action?: string;
  screen?: string;
  flow_token?: string;
  data?: Record<string, unknown> | null;
};

export type FlowResponse = { screen?: string; data: Record<string, unknown> };

type Item = { id: string; title: string; description?: string };

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function money(n: number): string {
  return "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
}

export function fmtFlowDate(iso: string): string {
  const p = String(iso || "").split("-").map(Number);
  if (p.length !== 3 || p.some((x) => !Number.isFinite(x))) return String(iso || "");
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return `${DIAS[d.getUTCDay()]} ${p[2]} ${MESES[p[1] - 1]}`;
}

function cut(s: unknown, n: number): string {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

const NO_EXTRAS_ID = "sin_extras";
const NO_PRIVATE_ID = "sin_barrios";

function errorFields(error: string | null) {
  return { has_error: !!error, error_text: error ?? "" };
}

function serviceItems(cat: FlowCatalog): Item[] {
  return cat.services.map((s) => ({
    id: s.id,
    title: cut(s.name, 30),
    description: cut(`Desde ${money(s.base_price)}${s.description ? ` · ${s.description}` : ""}`, 300),
  }));
}

function vehicleItems(cat: FlowCatalog): Item[] {
  return cat.vehicle_types.map((v) => ({ id: v, title: cut(v, 30) }));
}

function extraItems(cat: FlowCatalog): Item[] {
  const items = cat.extras.map((e) => ({ id: e.code, title: cut(e.name, 30), description: `+ ${money(e.amount)}` }));
  return items.length ? items : [{ id: NO_EXTRAS_ID, title: "Sin extras disponibles" }];
}

async function servicioScreen(deps: FlowDeps, screen: "SERVICIO" | "SEGUNDO_VEHICULO", error: string | null) {
  const cat = await deps.catalog();
  return {
    screen,
    data: {
      services: serviceItems(cat),
      vehicle_types: vehicleItems(cat),
      extras: extraItems(cat),
      ...errorFields(error),
    },
  };
}

async function ubicacionScreen(deps: FlowDeps, session: FlowSession, error: string | null) {
  const list = await deps.neighborhoods();
  const draft = session.draft;
  const name = draft.customer_name || (await deps.knownName(session.customer_phone)) || "";
  return {
    screen: "UBICACION",
    data: {
      customer_name: name,
      address: draft.address_input ?? "",
      private_lot: draft.private_lot ?? "",
      private_neighborhoods: list.length
        ? list.map((n) => ({ id: n.id, title: cut(n.name, 30) }))
        : [{ id: NO_PRIVATE_ID, title: "No hay barrios cargados" }],
      ...errorFields(error),
    },
  };
}

function dateItems(slots: FlowSlotMap): Item[] {
  return Object.keys(slots)
    .filter((d) => (slots[d] ?? []).length > 0)
    .sort()
    .slice(0, 14)
    .map((d) => ({
      id: d,
      title: fmtFlowDate(d),
      description: `${slots[d].length} horario${slots[d].length === 1 ? "" : "s"} libre${slots[d].length === 1 ? "" : "s"}`,
    }));
}

function timeItems(slots: FlowSlotMap, date: string): Item[] {
  return (slots[date] ?? []).map((s) => ({
    id: s.start_time.slice(0, 5),
    title: `${s.start_time.slice(0, 5)} hs`,
    description: `Termina ~${s.end_time.slice(0, 5)} hs`,
  }));
}

function addressLabel(draft: FlowDraft): string {
  if (draft.address_type === "private_neighborhood") {
    return `${draft.private_neighborhood_name ?? "Barrio cerrado"}${draft.private_lot ? ` · ${draft.private_lot}` : ""}`;
  }
  return draft.formatted_address || draft.address || "";
}

async function turnoScreen(
  deps: FlowDeps,
  session: FlowSession,
  slots: FlowSlotMap,
  selectedDate: string | null,
  error: string | null,
) {
  const dates = dateItems(slots);
  const date = selectedDate && dates.some((d) => d.id === selectedDate) ? selectedDate : dates[0]?.id ?? "";
  return {
    screen: "TURNO",
    data: {
      address_label: `📍 ${addressLabel(session.draft)}`,
      dates,
      selected_date: date,
      times: timeItems(slots, date),
      discount_code: session.draft.discount_code ?? "",
      ...errorFields(error),
    },
  };
}

const PAYMENT_LABEL: Record<string, string> = {
  MercadoPago: "Mercado Pago (QR, link o alias)",
  Transferencia: "Transferencia bancaria",
  "Pagar después": "Pago el día del lavado",
};

function resumenScreen(draft: FlowDraft, quote: Extract<FlowQuote, { ok: true }>) {
  return {
    screen: "RESUMEN",
    data: {
      summary_units: quote.detail_lines.join("\n"),
      summary_when: `📅 ${fmtFlowDate(draft.scheduled_date ?? "")} a las ${draft.scheduled_time} hs`,
      summary_where: `📍 ${addressLabel(draft)}`,
      summary_payment: `💳 ${PAYMENT_LABEL[draft.payment_method ?? ""] ?? draft.payment_method ?? ""}`,
      summary_total: `Total: ${money(quote.total)}`,
    },
  };
}

function expiredError() {
  return "Este formulario venció. Cerralo y tocá *Reservar turno* de nuevo en el chat.";
}

function unitFromPayload(
  cat: FlowCatalog,
  vehicle: string,
  serviceId: string,
  extras: string[],
): FlowUnit | string {
  const svc = cat.services.find((s) => s.id === serviceId);
  if (!svc) return "Elegí el servicio.";
  if (!cat.vehicle_types.includes(vehicle)) return "Elegí el tipo de vehículo.";
  const codes = extras.filter((e) => e !== NO_EXTRAS_ID);
  const known = new Set(cat.extras.map((e) => e.code));
  if (codes.some((c) => !known.has(c))) return "Uno de los extras ya no está disponible, volvé a elegirlos.";
  return { vehicle_type: vehicle, service_id: svc.id, service_name: svc.name, extras: [...new Set(codes)] };
}

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Main entry: one decrypted Flow request in, one (unencrypted) Flow response out. */
export async function handleBookingFlowRequest(req: FlowRequest, deps: FlowDeps): Promise<FlowResponse> {
  const action = str(req.action);
  const data = (req.data && typeof req.data === "object") ? req.data : {};

  if (action === "ping") return { data: { status: "active" } };
  // Client-side error notification (e.g. a screen failed to render): acknowledge.
  if (data.error) return { data: { acknowledged: true } };

  const token = str(req.flow_token);
  const session = token ? await deps.loadSession(token) : null;
  const expired = !session || session.status === "booked" ||
    Date.parse(session.expires_at) < deps.now();

  if (action === "INIT" || action === "BACK") {
    return await servicioScreen(deps, "SERVICIO", expired ? expiredError() : null);
  }
  if (action !== "data_exchange") {
    return await servicioScreen(deps, "SERVICIO", null);
  }

  const step = str(data.step) || str(req.screen);
  if (expired || !session) {
    const screen = (FLOW_SCREENS as readonly string[]).includes(step) ? step : "SERVICIO";
    if (screen === "UBICACION") {
      return await ubicacionScreen(deps, { flow_token: token, customer_phone: "", draft: {}, status: "expired", expires_at: "" }, expiredError());
    }
    return await servicioScreen(deps, screen === "SEGUNDO_VEHICULO" ? "SEGUNDO_VEHICULO" : "SERVICIO", expiredError());
  }
  const draft: FlowDraft = { ...(session.draft ?? {}) };

  if (step === "SERVICIO" || step === "SEGUNDO_VEHICULO") {
    const cat = await deps.catalog();
    const isSecond = step === "SEGUNDO_VEHICULO";
    const suffix = isSecond ? "2" : "1";
    const unit = unitFromPayload(
      cat,
      str(data[`vehicle_${suffix}`]),
      str(data[`service_${suffix}`]),
      strList(data[`extras_${suffix}`]),
    );
    if (typeof unit === "string") return await servicioScreen(deps, step, unit);
    const units = [...(draft.units ?? [])];
    units[isSecond ? 1 : 0] = unit;
    if (!isSecond) {
      draft.vehicle_count = str(data.vehicle_count) === "2" ? 2 : 1;
      if (draft.vehicle_count === 1) units.length = 1;
    }
    draft.units = units;
    // Changing vehicles invalidates a previously chosen slot (duration changes).
    delete draft.scheduled_date;
    delete draft.scheduled_time;
    await deps.saveDraft(token, draft, "open");
    if (!isSecond && draft.vehicle_count === 2) return await servicioScreen(deps, "SEGUNDO_VEHICULO", null);
    return await ubicacionScreen(deps, { ...session, draft }, null);
  }

  if (step === "UBICACION") {
    const name = str(data.customer_name);
    const type = str(data.address_type) === "private" ? "private_neighborhood" : "street";
    draft.customer_name = name;
    draft.address_type = type;
    if (name.length < 2) {
      await deps.saveDraft(token, draft, "open");
      return await ubicacionScreen(deps, { ...session, draft }, "Escribí tu nombre y apellido.");
    }
    let check: FlowAddressCheck;
    if (type === "street") {
      const address = str(data.address);
      draft.address_input = address;
      if (address.length < 5) {
        await deps.saveDraft(token, draft, "open");
        return await ubicacionScreen(deps, { ...session, draft }, "Escribí la dirección: calle, altura y localidad.");
      }
      check = await deps.checkAddress({ address_type: "street", address }, session.customer_phone);
    } else {
      const list = await deps.neighborhoods();
      const id = str(data.private_neighborhood);
      const nb = list.find((n) => n.id === id);
      const lot = str(data.private_lot);
      draft.private_lot = lot;
      if (!nb) {
        await deps.saveDraft(token, draft, "open");
        return await ubicacionScreen(deps, { ...session, draft }, "Elegí el barrio cerrado de la lista.");
      }
      if (!lot) {
        await deps.saveDraft(token, draft, "open");
        return await ubicacionScreen(deps, { ...session, draft }, "Indicá el lote, casa o manzana.");
      }
      draft.private_neighborhood_id = nb.id;
      draft.private_neighborhood_name = nb.name;
      check = await deps.checkAddress({
        address_type: "private_neighborhood",
        private_neighborhood_id: nb.id,
        private_neighborhood_name: nb.name,
      }, session.customer_phone);
    }
    if (!check.ok) {
      await deps.saveDraft(token, draft, "open");
      return await ubicacionScreen(deps, { ...session, draft }, "No pudimos validar la dirección. Revisala y probá de nuevo.");
    }
    if (!check.inside_coverage) {
      await deps.saveDraft(token, draft, "open");
      return await ubicacionScreen(
        deps,
        { ...session, draft },
        "Todavía no llegamos a esa zona 📍 Probá con otra dirección o escribinos *humano* en el chat.",
      );
    }
    draft.formatted_address = check.formatted_address || draft.address_input || draft.private_neighborhood_name || "";
    draft.address = draft.formatted_address;
    draft.neighborhood = check.neighborhood || check.coverage_zone_name || draft.address;
    draft.place_id = check.place_id ?? "";
    draft.address_lat = check.address_lat ?? null;
    draft.address_lng = check.address_lng ?? null;
    draft.coverage_zone_id = check.coverage_zone_id ?? "";
    draft.coverage_zone_name = check.coverage_zone_name ?? "";
    if (check.private_neighborhood_id) draft.private_neighborhood_id = check.private_neighborhood_id;
    if (check.private_neighborhood_name) draft.private_neighborhood_name = check.private_neighborhood_name;
    await deps.saveDraft(token, draft, "open");

    const slots = await deps.slots(draft.units ?? []);
    if (!slots || !dateItems(slots).length) {
      return await ubicacionScreen(
        deps,
        { ...session, draft },
        "No quedan turnos libres en los próximos días 😓 Cerrá el formulario y escribí *humano* así te ayudamos.",
      );
    }
    return await turnoScreen(deps, { ...session, draft }, slots, draft.scheduled_date ?? null, null);
  }

  if (step === "TURNO_DATE" || step === "TURNO") {
    const slots = (await deps.slots(draft.units ?? [])) ?? {};
    const date = str(data.date);
    if (step === "TURNO_DATE") return await turnoScreen(deps, { ...session, draft }, slots, date, null);

    const time = str(data.time);
    const method = str(data.payment_method);
    const code = str(data.discount_code);
    draft.discount_code = code;
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) {
      return await turnoScreen(deps, { ...session, draft }, slots, date, "Elegí el día y el horario.");
    }
    if (!(slots[date] ?? []).some((s) => s.start_time.slice(0, 5) === time)) {
      return await turnoScreen(deps, { ...session, draft }, slots, date, "Ese horario se acaba de ocupar 😕 Elegí otro.");
    }
    if (!(FLOW_PAYMENT_METHODS as readonly string[]).includes(method)) {
      return await turnoScreen(deps, { ...session, draft }, slots, date, "Elegí la forma de pago.");
    }
    const quote = await deps.quote(draft.units ?? [], code);
    if (!quote.ok) {
      const msg = quote.error === "invalid_discount_code"
        ? `${quote.message ?? "Ese código no es válido."} Corregilo o dejalo vacío.`
        : "No pudimos calcular el precio. Probá de nuevo en un momento.";
      await deps.saveDraft(token, draft, "open");
      return await turnoScreen(deps, { ...session, draft }, slots, date, msg);
    }
    draft.scheduled_date = date;
    draft.scheduled_time = time;
    draft.payment_method = method;
    draft.total = quote.total;
    draft.summary_lines = quote.lines;
    await deps.saveDraft(token, draft, "ready");
    return resumenScreen(draft, quote);
  }

  return await servicioScreen(deps, "SERVICIO", null);
}

/** Draft → fields for tryCreateBooking. Returns a reason when the form is not complete. */
export function draftToBookingFields(draft: FlowDraft):
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; reason: "form_incomplete"; missing: string[] } {
  const missing: string[] = [];
  const units = draft.units ?? [];
  if (!units.length || !units[0]?.service_id) missing.push("units");
  if (!draft.address) missing.push("address");
  if (!draft.scheduled_date || !DATE_RE.test(draft.scheduled_date)) missing.push("scheduled_date");
  if (!draft.scheduled_time || !TIME_RE.test(draft.scheduled_time)) missing.push("scheduled_time");
  if (!draft.payment_method) missing.push("payment_method");
  if (missing.length) return { ok: false, reason: "form_incomplete", missing };
  const first = units[0];
  return {
    ok: true,
    fields: {
      customer_name: draft.customer_name ?? "",
      address: draft.address,
      neighborhood: draft.neighborhood || draft.address,
      address_type: draft.address_type ?? "street",
      private_neighborhood_id: draft.private_neighborhood_id || null,
      private_lot: draft.private_lot || null,
      place_id: draft.place_id || null,
      formatted_address: draft.formatted_address || draft.address,
      address_lat: draft.address_lat ?? null,
      address_lng: draft.address_lng ?? null,
      coverage_zone_id: draft.coverage_zone_id || null,
      coverage_zone_name: draft.coverage_zone_name || null,
      service_id: first.service_id,
      vehicle_type: first.vehicle_type,
      selected_extras: first.extras,
      booking_units: units.length > 1
        ? units.map((u) => ({ vehicle_type: u.vehicle_type, service_id: u.service_id, selected_extras: u.extras }))
        : undefined,
      scheduled_date: draft.scheduled_date,
      scheduled_time: draft.scheduled_time,
      payment_method: draft.payment_method,
      discount_code: draft.discount_code || null,
    },
  };
}
