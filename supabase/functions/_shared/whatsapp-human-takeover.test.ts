import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  humanTakeoverUntil,
  isHumanTakeoverActive,
  looksSentFromBusinessApp,
  wamidContactId,
} from "./whatsapp-human-takeover.ts";

// Real ids from the Washero number (2026-11-19).
const APP_SENT = "wamid.HBgTQVIuMjY3NTU5MDU4NjI0Njc5NRUUABEYFDJBQjJFQjU2MEJBQUJDNEJFNEZFAA==";
const APP_SENT_2 = "wamid.HBgTQVIuMjY3NTU5MDU4NjI0Njc5NRUUABEYFDJBRUQwODkxOTEyQTgxNjI1RjYwAA==";
const BOT_SENT = "wamid.HBgNNTQ5MTE2MzU0MDk5MxUCABEYFENFMUYyMTQ1OTQyNDNEMjE2RTQxAA==";
const INBOUND = "wamid.HBgNNTQ5MTE2MzU0MDk5MxUCABIYIEFDOTM5RUEwNUMxNjlEQjU3MTU0MUJGMkEyRDdGQTg1AA==";

Deno.test("decodes the contact id inside a wamid", () => {
  assertEquals(wamidContactId(APP_SENT), "AR.2675590586246795");
  assertEquals(wamidContactId(BOT_SENT), "5491163540993");
  assertEquals(wamidContactId("nope"), null);
  assertEquals(wamidContactId("wamid.!!!"), null);
});

Deno.test("only Business-app sends count as a human writing", () => {
  assertEquals(looksSentFromBusinessApp(APP_SENT), true);
  assertEquals(looksSentFromBusinessApp(APP_SENT_2), true);
  assertEquals(looksSentFromBusinessApp(BOT_SENT), false);
  assertEquals(looksSentFromBusinessApp(INBOUND), false);
  assertEquals(looksSentFromBusinessApp(""), false);
});

Deno.test("takeover window", () => {
  const now = new Date("2026-11-19T14:14:00Z");
  const until = humanTakeoverUntil(now);
  assertEquals(until, "2026-11-20T02:14:00.000Z");
  assertEquals(isHumanTakeoverActive("human", { human_until: until }, now), true);
  assertEquals(isHumanTakeoverActive("human", { human_until: until }, new Date("2026-11-20T02:15:00Z")), false);
  assertEquals(isHumanTakeoverActive("menu", { human_until: until }, now), false);
  assertEquals(isHumanTakeoverActive("human", {}, now), false);
});
