import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planCampaign } from "./marketing-campaign.ts";
import { findMarketingTemplate } from "./marketing-templates.ts";

const promo = findMarketingTemplate("promo_descuento")!;
const consentTpl = findMarketingTemplate("consentimiento_promos")!;
const manual = { discount: "20%", code: "LAVADO20", valid_until: "30/11" };

function base(over: Partial<Parameters<typeof planCampaign>[0]> = {}) {
  return {
    def: promo,
    manualValues: manual,
    customers: [],
    consentByCustomer: new Map(),
    recentlyMessaged: new Set<string>(),
    historyByCustomer: new Map(),
    ...over,
  } as Parameters<typeof planCampaign>[0];
}

Deno.test("only opted-in customers get a promo; the rest are skipped with a reason", () => {
  const plan = planCampaign(base({
    customers: [
      { id: "a", full_name: "Ana Pérez", phone: "+54 9 11 5555-0001" },
      { id: "b", full_name: "Beto", phone: "+54 9 11 5555-0002" },
      { id: "c", full_name: "Caro", phone: "+54 9 11 5555-0003" },
      { id: "d", full_name: "Dani", phone: "123" },
      { id: "e", full_name: "Ana bis", phone: "5491155550001" },
      { id: "f", full_name: "Fede", phone: "+54 9 11 5555-0006" },
    ],
    consentByCustomer: new Map([
      ["a", "opted_in"],
      ["b", "opted_out"],
      ["e", "opted_in"],
      ["f", "opted_in"],
    ]),
    recentlyMessaged: new Set(["f"]),
  }));
  assertEquals(plan.recipients.map((r) => r.customerId), ["a"]);
  assertEquals(plan.recipients[0].to, "541155550001");
  assertEquals(plan.skipped.map((s) => [s.customerId, s.reason]), [
    ["b", "opted_out"],
    ["c", "no_consent"],
    ["d", "invalid_phone"],
    ["e", "duplicate_phone"],
    ["f", "recently_messaged"],
  ]);
  assertEquals(plan.skippedByReason.no_consent, 1);
});

Deno.test("the consent request may reach contacts without consent but never opted-out ones", () => {
  const plan = planCampaign(base({
    def: consentTpl,
    manualValues: {},
    customers: [
      { id: "a", full_name: "Sin nombre (WhatsApp)", phone: "+54 9 11 5555-0001" },
      { id: "b", full_name: "Beto", phone: "+54 9 11 5555-0002" },
    ],
    consentByCustomer: new Map([["b", "opted_out"]]),
  }));
  assertEquals(plan.recipients.map((r) => r.customerId), ["a"]);
  assertEquals(plan.skipped.map((s) => s.reason), ["opted_out"]);
});

Deno.test("missing manual values skip everyone instead of sending a broken message", () => {
  const plan = planCampaign(base({
    manualValues: { discount: "20%" },
    customers: [{ id: "a", full_name: "Ana", phone: "+54 9 11 5555-0001" }],
    consentByCustomer: new Map([["a", "opted_in"]]),
  }));
  assertEquals(plan.recipients.length, 0);
  assertEquals(plan.skippedByReason.missing_values, 1);
});

Deno.test("retention template uses each customer's history", () => {
  const plan = planCampaign(base({
    def: findMarketingTemplate("recuperar_cliente")!,
    manualValues: {},
    customers: [{ id: "a", full_name: "Ana", phone: "+54 9 11 5555-0001" }],
    consentByCustomer: new Map([["a", "opted_in"]]),
    historyByCustomer: new Map([["a", { daysSinceLastWash: 52, lastVehicle: "SUV" }]]),
  }));
  const params = (plan.recipients[0].payload.template as {
    components: Array<{ parameters: Array<{ text: string }> }>;
  }).components[0].parameters.map((p) => p.text);
  assertEquals(params, ["Ana", "52", "suv"]);
});
