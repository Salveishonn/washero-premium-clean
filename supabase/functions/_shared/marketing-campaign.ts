// Who actually receives a WhatsApp marketing campaign. Pure planning, no I/O.
//
// Gates, in order (a recipient is skipped with the first reason that applies):
//   invalid_phone     not an Argentine mobile
//   duplicate_phone   another selected customer already has this phone
//   opted_out         said no to promos (never overridden)
//   no_consent        no opt-in recorded (only the consent-request template may go to them)
//   recently_messaged got a campaign in the last FREQUENCY_CAP_DAYS days
//   missing_values    a template value could not be filled for this person
import { parseArgentinaMobile } from "./argentina-phone.ts";
import {
  buildTemplateSendPayload,
  resolveTemplateValues,
  type MarketingTemplateDef,
} from "./marketing-templates.ts";

export const MAX_CAMPAIGN_RECIPIENTS = 1000;
export const FREQUENCY_CAP_DAYS = 7;

export type CampaignSkipReason =
  | "invalid_phone"
  | "duplicate_phone"
  | "opted_out"
  | "no_consent"
  | "recently_messaged"
  | "missing_values";

export type CampaignCustomer = { id: string; full_name: string | null; phone: string | null };

export type CampaignInputs = {
  def: MarketingTemplateDef;
  manualValues: Record<string, string>;
  customers: CampaignCustomer[];
  /** customer_id → stored consent status. Absent = no record. */
  consentByCustomer: Map<string, "opted_in" | "opted_out">;
  /** customer_ids that got any campaign inside the frequency window. */
  recentlyMessaged: Set<string>;
  /** customer_id → days since last completed wash / last vehicle. */
  historyByCustomer: Map<string, { daysSinceLastWash: number | null; lastVehicle: string | null }>;
};

export type PlannedRecipient = {
  customerId: string;
  /** Cloud API recipient (54 + area + number, without the mobile 9). */
  to: string;
  phoneDisplay: string;
  payload: Record<string, unknown>;
};

export type SkippedRecipient = { customerId: string; phone: string; reason: CampaignSkipReason };

export type CampaignPlan = {
  recipients: PlannedRecipient[];
  skipped: SkippedRecipient[];
  skippedByReason: Record<CampaignSkipReason, number>;
};

/** Cloud API wants 54 + 10-digit national number (the mobile 9 is dropped). */
export function cloudRecipientFromNational(national: string): string {
  return `54${national}`;
}

export function planCampaign(input: CampaignInputs): CampaignPlan {
  const skippedByReason: Record<CampaignSkipReason, number> = {
    invalid_phone: 0,
    duplicate_phone: 0,
    opted_out: 0,
    no_consent: 0,
    recently_messaged: 0,
    missing_values: 0,
  };
  const recipients: PlannedRecipient[] = [];
  const skipped: SkippedRecipient[] = [];
  const seenPhones = new Set<string>();
  const skip = (c: CampaignCustomer, reason: CampaignSkipReason) => {
    skippedByReason[reason] += 1;
    skipped.push({ customerId: c.id, phone: String(c.phone ?? ""), reason });
  };

  for (const customer of input.customers) {
    const parsed = parseArgentinaMobile(customer.phone);
    if (!parsed.ok) {
      skip(customer, "invalid_phone");
      continue;
    }
    if (seenPhones.has(parsed.national)) {
      skip(customer, "duplicate_phone");
      continue;
    }
    seenPhones.add(parsed.national);

    const consent = input.consentByCustomer.get(customer.id);
    if (consent === "opted_out") {
      skip(customer, "opted_out");
      continue;
    }
    if (consent !== "opted_in" && !input.def.isConsentRequest) {
      skip(customer, "no_consent");
      continue;
    }
    if (input.recentlyMessaged.has(customer.id)) {
      skip(customer, "recently_messaged");
      continue;
    }
    const history = input.historyByCustomer.get(customer.id);
    const values = resolveTemplateValues(input.def, input.manualValues, {
      fullName: customer.full_name,
      daysSinceLastWash: history?.daysSinceLastWash ?? null,
      lastVehicle: history?.lastVehicle ?? null,
    });
    if (!values) {
      skip(customer, "missing_values");
      continue;
    }
    const to = cloudRecipientFromNational(parsed.national);
    recipients.push({
      customerId: customer.id,
      to,
      phoneDisplay: parsed.display,
      payload: buildTemplateSendPayload(input.def, to, values),
    });
  }
  return { recipients, skipped, skippedByReason };
}
