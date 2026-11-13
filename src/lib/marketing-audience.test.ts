import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildAudienceMembers,
  filterAudience,
  renderTemplatePreview,
  summarizeConsent,
} from "./marketing-audience";

const customers = [
  { id: "lead", full_name: "Lead", phone: "1", created_at: "" },
  { id: "one", full_name: "Uno", phone: "2", created_at: "" },
  { id: "rec", full_name: "Rec", phone: "3", created_at: "" },
  { id: "future", full_name: "Futuro", phone: "4", created_at: "" },
];
const bookings = [
  { customer_id: "one", scheduled_date: "2026-10-01", booking_status: "completed" },
  { customer_id: "rec", scheduled_date: "2026-09-01", booking_status: "completed" },
  { customer_id: "rec", scheduled_date: "2026-10-01", booking_status: "completed" },
  { customer_id: "future", scheduled_date: "2026-08-01", booking_status: "completed" },
  { customer_id: "future", scheduled_date: "2026-12-01", booking_status: "confirmed" },
];

const members = buildAudienceMembers({
  customers,
  bookings,
  preferences: [
    { customer_id: "one", status: "opted_in" },
    { customer_id: "rec", status: "opted_out" },
  ],
  signals: [
    {
      customer_id: "lead",
      signal: "precios",
      hits: 1,
      first_seen_at: "",
      last_seen_at: "",
      detail: null,
    },
  ],
  todayIso: "2026-11-14",
});

describe("marketing audience", () => {
  it("splits contacts by stage and recovery", () => {
    expect(filterAudience(members, "leads", "all").map((m) => m.id)).toEqual(["lead"]);
    expect(filterAudience(members, "clientes", "all").map((m) => m.id)).toEqual(["one", "future"]);
    expect(filterAudience(members, "recurrentes", "all").map((m) => m.id)).toEqual(["rec"]);
    expect(filterAudience(members, "recuperar", "all").map((m) => m.id)).toEqual(["one", "rec"]);
    expect(filterAudience(members, "todos", "precios").map((m) => m.id)).toEqual(["lead"]);
  });

  it("summarizes consent", () => {
    expect(summarizeConsent(members)).toEqual({ total: 4, optedIn: 1, optedOut: 1, unknown: 2 });
  });

  it("renders a preview with values or examples", () => {
    const tpl = {
      body: "Hola {{1}}! Tenés {{2}} off.",
      variables: [
        { key: "first_name", label: "Nombre", example: "Juan" },
        { key: "discount", label: "Descuento", example: "20%" },
      ],
    };
    expect(renderTemplatePreview(tpl, { discount: "30%" })).toBe("Hola Juan! Tenés 30% off.");
  });
});
