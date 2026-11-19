import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  botSilence,
  buenosAiresClock,
  DEFAULT_BOT_SETTINGS,
  DEFAULT_BOT_TEXTS,
  isWithinBusinessHours,
  resolveBotSettings,
} from "./whatsapp-bot-settings.ts";

Deno.test("empty or broken settings fall back to defaults", () => {
  assertEquals(resolveBotSettings(null), DEFAULT_BOT_SETTINGS);
  assertEquals(resolveBotSettings({}), DEFAULT_BOT_SETTINGS);
  const r = resolveBotSettings({
    bot_enabled: "yes",
    human_takeover_hours: 500,
    texts: { thanks: "   ", menu_body: "Hola!" },
    survey: { delay_hours: "6", review_url: "javascript:alert(1)" },
    business_hours: { days: { mon: { open: "25:00", close: "18:30", on: false } } },
  });
  assertEquals(r.bot_enabled, true);
  assertEquals(r.human_takeover_hours, 72);
  assertEquals(r.texts.thanks, DEFAULT_BOT_TEXTS.thanks);
  assertEquals(r.texts.menu_body, "Hola!");
  assertEquals(r.survey.delay_hours, 6);
  assertEquals(r.survey.review_url, "");
  assertEquals(r.business_hours.days.mon, { on: false, open: "08:00", close: "18:30" });
});

Deno.test("Buenos Aires clock", () => {
  // 2026-11-19 is a Thursday. 02:30 UTC = 23:30 Wednesday in Buenos Aires.
  assertEquals(buenosAiresClock(new Date("2026-11-19T02:30:00Z")), { day: "wed", minutes: 23 * 60 + 30 });
  assertEquals(buenosAiresClock(new Date("2026-11-19T15:00:00Z")), { day: "thu", minutes: 12 * 60 });
});

Deno.test("business hours", () => {
  const s = resolveBotSettings({ business_hours: { enabled: true } });
  assertEquals(isWithinBusinessHours(s, new Date("2026-11-19T15:00:00Z")), true); // thu 12:00
  assertEquals(isWithinBusinessHours(s, new Date("2026-11-19T23:30:00Z")), false); // thu 20:30
  assertEquals(isWithinBusinessHours(s, new Date("2026-11-22T15:00:00Z")), false); // sun off
  const night = resolveBotSettings({
    business_hours: { enabled: true, days: { thu: { on: true, open: "20:00", close: "02:00" } } },
  });
  assertEquals(isWithinBusinessHours(night, new Date("2026-11-19T23:30:00Z")), true); // thu 20:30
  assertEquals(isWithinBusinessHours(resolveBotSettings({}), new Date("2026-11-22T15:00:00Z")), true);
});

Deno.test("global silence", () => {
  const sunday = new Date("2026-11-22T15:00:00Z");
  assertEquals(botSilence(resolveBotSettings({}), sunday), { silenced: false, after_hours: false });
  assertEquals(botSilence(resolveBotSettings({ bot_enabled: false }), sunday), { silenced: true, reason: "bot_disabled" });
  assertEquals(
    botSilence(resolveBotSettings({ business_hours: { enabled: true } }), sunday),
    { silenced: false, after_hours: true },
  );
  assertEquals(
    botSilence(resolveBotSettings({ business_hours: { enabled: true, after_hours_mode: "silent" } }), sunday),
    { silenced: true, reason: "after_hours" },
  );
});
