import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  SURVEY_TEMPLATE_BODY,
  buildSurveySendPayload,
  buildSurveyTemplateCreatePayload,
  isSurveySendingHour,
  pickSurveyCandidates,
  resolveWashCompletedAt,
} from "./satisfaction-survey.ts";

const H = 3600_000;
// 2026-11-13 15:00 in Buenos Aires = 18:00 UTC
const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);

const row = (id: string, hoursAgo: number, extra: Record<string, unknown> = {}) => ({
  booking_id: id,
  wash_completed_at: new Date(NOW - hoursAgo * H).toISOString(),
  customer_phone: "5491122334455",
  booking_status: "completed",
  is_test: false,
  ...extra,
});

Deno.test("candidates: completed 4h–48h ago, real, not surveyed", () => {
  const picked = pickSurveyCandidates(
    [
      row("fresh", 1),
      row("due", 4.5),
      row("old", 60),
      row("test", 5, { is_test: true }),
      row("cancelled", 5, { booking_status: "cancelled" }),
      row("nophone", 5, { customer_phone: "" }),
      row("done", 6),
    ],
    new Set(["done"]),
    NOW,
  );
  assertEquals(picked.map((p) => p.booking_id), ["due"]);
});

Deno.test("quiet hours in Buenos Aires", () => {
  assertEquals(isSurveySendingHour(NOW), true); // 15:00
  assertEquals(isSurveySendingHour(Date.UTC(2026, 10, 14, 2, 0)), false); // 23:00
  assertEquals(isSurveySendingHour(Date.UTC(2026, 10, 14, 11, 30)), false); // 08:30
  assertEquals(isSurveySendingHour(Date.UTC(2026, 10, 14, 12, 0)), true); // 09:00
});

Deno.test("send payload carries the booking id in both quick replies", () => {
  const p = buildSurveySendPayload({ to: "541122334455", bookingId: "bk-1", customerName: "Pedro Gómez", vehicleType: "SUV" }) as any;
  assertEquals(p.template.components[0].parameters.map((x: any) => x.text), ["Pedro", "SUV"]);
  assertEquals(p.template.components[1].parameters[0].payload, "survey:good:bk-1");
  assertEquals(p.template.components[2].parameters[0].payload, "survey:bad:bk-1");
});

Deno.test("template follows Meta's variable rules", () => {
  const t = buildSurveyTemplateCreatePayload("https://g.page/r/washero/review") as any;
  assertEquals(t.category, "UTILITY");
  const found = [...SURVEY_TEMPLATE_BODY.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
  assertEquals(found, ["1", "2"]);
  assert(!/^\s*\{\{/.test(SURVEY_TEMPLATE_BODY) && !/\}\}\s*$/.test(SURVEY_TEMPLATE_BODY));
  assert(SURVEY_TEMPLATE_BODY.length <= 1024);
  for (const b of t.components[2].buttons) assert(b.text.length <= 25, b.text);
});

Deno.test("template carries the Google review button after the quick replies", () => {
  const t = buildSurveyTemplateCreatePayload("https://g.page/r/washero/review") as any;
  const buttons = t.components[2].buttons;
  assertEquals(buttons.map((b: any) => b.type), ["QUICK_REPLY", "QUICK_REPLY", "URL"]);
  assertEquals(buttons[2].url, "https://g.page/r/washero/review");
});

Deno.test("wash completion time comes from the best available source", () => {
  const t1 = "2026-11-17T15:00:00Z";
  const t2 = "2026-11-17T15:05:00Z";
  assertEquals(resolveWashCompletedAt({ wash_completed_at: t1, phase: "wash_completed", phase_changed_at: t2 }, {}), t1);
  assertEquals(resolveWashCompletedAt({ wash_completed_at: null, phase: "wash_completed", phase_changed_at: t2 }, {}), t2);
  assertEquals(resolveWashCompletedAt({ phase: "closed", closed_at: t1, phase_changed_at: t2 }, {}), t1);
  assertEquals(resolveWashCompletedAt({ phase: "en_route", phase_changed_at: t2 }, { booking_status: "confirmed" }), null);
  assertEquals(resolveWashCompletedAt(null, { booking_status: "completed", updated_at: t2 }), t2);
  assertEquals(resolveWashCompletedAt(null, { booking_status: "confirmed", updated_at: t2 }), null);
});

Deno.test("submitting without a valid review URL is refused", () => {
  for (const bad of ["", "g.page/r/x", "http://insecure.example"]) {
    let threw = false;
    try { buildSurveyTemplateCreatePayload(bad); } catch { threw = true; }
    assert(threw, bad);
  }
});
