import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  countUnread,
  distanceMeters,
  formatRuleTimeWindow,
  formatRuleWeekdays,
  formatRuleZones,
  locationFreshness,
  shouldSendLocation,
  staffDisplayName,
  threadKey,
} from "./staff";

describe("staff helpers", () => {
  it("builds thread keys", () => {
    expect(threadKey(null)).toBe("general");
    expect(threadKey("abc")).toBe("abc");
  });

  it("prefers full name, falls back to email local part", () => {
    expect(staffDisplayName({ full_name: " Juan ", email: "j@x.com" })).toBe("Juan");
    expect(staffDisplayName({ full_name: null, email: "pedro@x.com" })).toBe("pedro");
    expect(staffDisplayName(null)).toBe("—");
  });

  it("formats rule weekdays", () => {
    expect(formatRuleWeekdays(null)).toBe("Todos los días");
    expect(formatRuleWeekdays([5, 4, 3, 2, 1])).toBe("Lun a Vie");
    expect(formatRuleWeekdays([6, 0])).toBe("Fines de semana");
    expect(formatRuleWeekdays([1, 3])).toBe("Lun, Mié");
  });

  it("formats rule time windows", () => {
    expect(formatRuleTimeWindow(null, null)).toBe("Todo el día");
    expect(formatRuleTimeWindow("08:00:00", "13:00:00")).toBe("08:00 – 13:00");
    expect(formatRuleTimeWindow("14:00:00", null)).toBe("Desde 14:00");
  });

  it("formats zones", () => {
    const zones = [{ id: "a", name: "Nordelta" }];
    expect(formatRuleZones(null, zones)).toBe("Todas las zonas");
    expect(formatRuleZones(["a", "b"], zones)).toBe("Nordelta, Zona eliminada");
  });

  it("classifies location freshness", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(locationFreshness(null, now)).toBe("off");
    expect(locationFreshness({ sharing: false, updated_at: "2026-11-17T12:00:00Z" }, now)).toBe("off");
    expect(locationFreshness({ sharing: true, updated_at: "2026-11-17T11:59:30Z" }, now)).toBe("live");
    expect(locationFreshness({ sharing: true, updated_at: "2026-11-17T11:50:00Z" }, now)).toBe("recent");
    expect(locationFreshness({ sharing: true, updated_at: "2026-11-17T10:00:00Z" }, now)).toBe("stale");
  });

  it("computes distances", () => {
    const d = distanceMeters({ lat: -34.4, lng: -58.6 }, { lat: -34.401, lng: -58.6 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("throttles location sends", () => {
    const last = { lat: -34.4, lng: -58.6, at: 0 };
    expect(shouldSendLocation({ last: null, next: last })).toBe(true);
    expect(shouldSendLocation({ last, next: { ...last, at: 5_000 } })).toBe(false);
    expect(shouldSendLocation({ last, next: { ...last, at: 20_000 } })).toBe(false);
    expect(shouldSendLocation({ last, next: { lat: -34.401, lng: -58.6, at: 20_000 } })).toBe(true);
    expect(shouldSendLocation({ last, next: { ...last, at: 61_000 } })).toBe(true);
  });

  it("counts unread messages from others after last read", () => {
    const msgs = [
      { created_at: "2026-11-17T10:00:00Z", sender_staff_id: "a" },
      { created_at: "2026-11-17T11:00:00Z", sender_staff_id: "b" },
      { created_at: "2026-11-17T11:30:00Z", sender_staff_id: "me" },
    ];
    expect(countUnread(msgs, null, "me")).toBe(2);
    expect(countUnread(msgs, "2026-11-17T10:30:00Z", "me")).toBe(1);
  });
});
