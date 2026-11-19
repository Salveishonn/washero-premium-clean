// Satisfaction survey sent ~4h after a wash is completed. Pure module (no I/O).
//
// The template is a UTILITY template with two quick replies plus a "Dejar reseña" URL button
// that opens Google reviews directly. Each quick reply carries a payload
// "survey:good:<booking_id>" / "survey:bad:<booking_id>" set at send time; Normalize Inbound
// passes it as reply_id and the n8n Flow Router answers (thanks + review link, or "contanos").
// Meta needs the review URL at submission time (static URL button): GOOGLE_REVIEW_URL.

export const SURVEY_TEMPLATE_NAME = "washero_encuesta_lavado_v1";
export const SURVEY_TEMPLATE_LANGUAGE = "es_AR";
export const SURVEY_DELAY_HOURS = 4;
/** Older completions are not surveyed (e.g. after an outage or when first enabling it). */
export const SURVEY_MAX_AGE_HOURS = 48;
export const SURVEY_GOOD_TEXT = "¡Todo excelente!";
export const SURVEY_BAD_TEXT = "Podría mejorar";
export const SURVEY_REVIEW_TEXT = "Dejar reseña en Google";

export const SURVEY_TEMPLATE_BODY =
  "Hola {{1}}, ¿cómo quedó tu {{2}}? 🚗✨ Hace un rato terminamos el lavado y nos encantaría saber qué te pareció. " +
  "Si te gustó, una reseña en Google nos ayuda muchísimo ⭐ Y si algo no salió perfecto, contanos acá.";

export function isValidReviewUrl(url: string | null | undefined): boolean {
  return /^https:\/\/\S+$/.test(String(url ?? "").trim());
}

export function buildSurveyTemplateCreatePayload(reviewUrl: string): Record<string, unknown> {
  if (!isValidReviewUrl(reviewUrl)) throw new Error("google_review_url_invalid");
  return {
    name: SURVEY_TEMPLATE_NAME,
    language: SURVEY_TEMPLATE_LANGUAGE,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: SURVEY_TEMPLATE_BODY,
        example: { body_text: [["Pedro", "auto"]] },
      },
      { type: "FOOTER", text: "Washero · Lavado a domicilio" },
      {
        type: "BUTTONS",
        // Meta requires quick replies and call-to-action buttons to be grouped.
        buttons: [
          { type: "QUICK_REPLY", text: SURVEY_GOOD_TEXT },
          { type: "QUICK_REPLY", text: SURVEY_BAD_TEXT },
          { type: "URL", text: SURVEY_REVIEW_TEXT, url: String(reviewUrl).trim() },
        ],
      },
    ],
  };
}

function firstName(full: string | null | undefined): string {
  const clean = String(full ?? "").trim();
  if (!clean || /^sin nombre/i.test(clean)) return "";
  return clean.split(/\s+/)[0].slice(0, 40);
}

function vehicleWord(vehicleType: string | null | undefined): string {
  const v = String(vehicleType ?? "").trim().toLowerCase();
  if (!v || v === "otro") return "vehículo";
  if (v === "pick-up" || v === "pickup") return "pick-up";
  if (v === "suv") return "SUV";
  return v;
}

export function buildSurveySendPayload(input: {
  to: string;
  bookingId: string;
  customerName: string | null;
  vehicleType: string | null;
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: input.to,
    type: "template",
    template: {
      name: SURVEY_TEMPLATE_NAME,
      language: { code: SURVEY_TEMPLATE_LANGUAGE },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: firstName(input.customerName) || "¡hola!" },
            { type: "text", text: vehicleWord(input.vehicleType) },
          ],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
          parameters: [{ type: "payload", payload: `survey:good:${input.bookingId}` }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "1",
          parameters: [{ type: "payload", payload: `survey:bad:${input.bookingId}` }],
        },
      ],
    },
  };
}

/** Buenos Aires hour (UTC-3, no DST). Surveys go out 9:00–21:59 only. */
export function isSurveySendingHour(nowMs: number): boolean {
  const h = new Date(nowMs - 3 * 3600_000).getUTCHours();
  return h >= 9 && h < 22;
}

export type SurveyCandidate = {
  booking_id: string;
  wash_completed_at: string;
  customer_phone: string | null;
  booking_status: string | null;
  is_test: boolean | null;
};

/**
 * When the wash finished. Operator flow sets booking_operations.wash_completed_at; older or
 * admin-closed washes only have the phase change, or just bookings.booking_status=completed.
 */
export function resolveWashCompletedAt(
  op: {
    phase?: string | null;
    wash_completed_at?: string | null;
    closed_at?: string | null;
    phase_changed_at?: string | null;
  } | null,
  booking: { booking_status?: string | null; updated_at?: string | null },
): string | null {
  if (op?.wash_completed_at) return op.wash_completed_at;
  if (op && (op.phase === "wash_completed" || op.phase === "closed")) {
    return op.closed_at || op.phase_changed_at || null;
  }
  if (booking.booking_status === "completed") return booking.updated_at ?? null;
  return null;
}

/** Completed between 48h and `delayHours` (default 4h) ago, real customer, not cancelled, not surveyed yet. */
export function pickSurveyCandidates(
  rows: SurveyCandidate[],
  alreadySurveyed: Set<string>,
  nowMs: number,
  delayHours: number = SURVEY_DELAY_HOURS,
): SurveyCandidate[] {
  const newest = nowMs - delayHours * 3600_000;
  const oldest = nowMs - SURVEY_MAX_AGE_HOURS * 3600_000;
  return rows.filter((r) => {
    const t = Date.parse(r.wash_completed_at);
    if (!Number.isFinite(t) || t > newest || t < oldest) return false;
    if (r.is_test) return false;
    if (r.booking_status === "cancelled") return false;
    if (!String(r.customer_phone ?? "").trim()) return false;
    return !alreadySurveyed.has(r.booking_id);
  });
}
