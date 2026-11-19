// Human takeover: when someone from Washero writes to a customer by hand from the WhatsApp
// Business app (coexistence number), the bot must stay quiet in that chat for a while.
//
// The Cloud API does not deliver the text of app-sent messages to our webhook, but it does
// deliver their status updates (sent / delivered / read). A status whose message id is not one
// the bot sent therefore means a person is talking to the customer.
//
// Observed wamid encodings (base64 protobuf, field 1 = the chat's contact id):
//   bot / edge function sends (Cloud API)  → contact id is the phone, e.g. "5491163540993"
//   sends from the WhatsApp Business app   → contact id is the BSUID, e.g. "AR.2675590586246795"
// We require both signals (unknown id AND non-phone contact id), so a status for a template or
// payment notice sent by an edge function never silences the bot.

export const HUMAN_TAKEOVER_STATE = "human";
export const HUMAN_TAKEOVER_HOURS = 12;

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Contact id embedded in a wamid, or null when the id can't be decoded. */
export function wamidContactId(wamid: string): string | null {
  const raw = String(wamid ?? "").trim();
  if (!raw.startsWith("wamid.")) return null;
  const bytes = base64ToBytes(raw.slice("wamid.".length));
  if (!bytes || bytes.length < 4) return null;
  // 0x1c 0x18 <len> <contact id bytes>
  if (bytes[0] !== 0x1c || bytes[1] !== 0x18) return null;
  const len = bytes[2];
  if (len <= 0 || 3 + len > bytes.length) return null;
  let s = "";
  for (let i = 3; i < 3 + len; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** True when the wamid looks like a message sent from the WhatsApp Business app. */
export function looksSentFromBusinessApp(wamid: string): boolean {
  const contact = wamidContactId(wamid);
  if (!contact) return false;
  return !/^\d+$/.test(contact);
}

export function humanTakeoverUntil(now: Date, hours = HUMAN_TAKEOVER_HOURS): string {
  return new Date(now.getTime() + hours * 3600_000).toISOString();
}

/** Is the stored conversation state an active human takeover? */
export function isHumanTakeoverActive(
  state: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  now: Date,
): boolean {
  if (state !== HUMAN_TAKEOVER_STATE) return false;
  const until = Date.parse(String(data?.human_until ?? ""));
  return Number.isFinite(until) && until > now.getTime();
}
