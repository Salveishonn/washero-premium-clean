/** Keep in sync with src/lib/phone.ts — Deno edge functions cannot import from src/. */

export const AR_MOBILE_INVALID_MESSAGE =
  "Ingresá un celular argentino válido, por ejemplo +54 9 11 1234-5678";

export type ArgentinaMobileOk = {
  ok: true;
  e164: string;
  national: string;
  display: string;
  lookupVariants: string[];
};

export type ArgentinaMobileErr = { ok: false; error: string };

export type ArgentinaMobileParse = ArgentinaMobileOk | ArgentinaMobileErr;

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function stripIntlPrefix(digits: string): string {
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

export function toArgentinaNational10(rawDigits: string): string | null {
  let d = stripIntlPrefix(rawDigits);
  if (!d) return null;

  if (d.startsWith("0")) return toArgentinaNational10(d.slice(1));

  if (d.startsWith("549") && d.length === 13) return d.slice(3);

  if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) return d.slice(2);

  if (d.startsWith("9") && d.length === 11) return d.slice(1);

  if (d.startsWith("15") && d.length === 10) return `11${d.slice(2)}`;

  if (d.startsWith("1115") && d.length === 12) return `11${d.slice(4)}`;

  if (d.length === 12 && d.slice(3, 5) === "15") return `${d.slice(0, 3)}${d.slice(5)}`;

  if (d.length === 12 && d.slice(4, 6) === "15") return `${d.slice(0, 4)}${d.slice(6)}`;

  if (d.length === 10) return d;

  return null;
}

function isValidNational(national: string): boolean {
  if (!/^\d{10}$/.test(national)) return false;
  if (national.startsWith("11")) return true;
  const first = national[0];
  return first === "2" || first === "3";
}

export function formatArgentinaMobileDisplay(national: string): string {
  if (national.startsWith("11") && national.length === 10) {
    const rest = national.slice(2);
    return `+54 9 11 ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  if (national.length === 10) {
    const area = national.slice(0, 3);
    const rest = national.slice(3);
    return `+54 9 ${area} ${rest.slice(0, 3)}-${rest.slice(3)}`;
  }
  return `+54 9 ${national}`;
}

export function argentinaMobileLookupVariants(
  national: string,
  display: string,
  e164: string,
  raw?: string,
): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    if (s) out.add(s);
  };

  add(raw);
  add(display);
  add(e164);
  add(e164.replace(/^\+/, ""));
  add(national);
  add(`0${national}`);
  add(`9${national}`);
  add(`54${national}`);
  add(`549${national}`);
  add(`+54${national}`);
  add(`+549${national}`);
  add(`+54 9 ${national}`);
  add(digitsOnly(display));

  if (national.startsWith("11")) {
    const local = national.slice(2);
    add(`15${local}`);
    add(`015${local}`);
    add(`011${national.slice(2)}`);
    add(`011${national}`);
    add(`01115${local}`);
    add(`11 ${local.slice(0, 4)}-${local.slice(4)}`);
    add(`011 ${local.slice(0, 4)}-${local.slice(4)}`);
  }

  return [...out];
}

export function parseArgentinaMobile(raw: string | null | undefined): ArgentinaMobileParse {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: AR_MOBILE_INVALID_MESSAGE };

  const national = toArgentinaNational10(digitsOnly(trimmed));
  if (!national || !isValidNational(national)) {
    return { ok: false, error: AR_MOBILE_INVALID_MESSAGE };
  }

  const e164 = `+549${national}`;
  const display = formatArgentinaMobileDisplay(national);
  return {
    ok: true,
    e164,
    national,
    display,
    lookupVariants: argentinaMobileLookupVariants(national, display, e164, trimmed),
  };
}

export function normalizeArgentinaMobileOrNull(raw: string | null | undefined): string | null {
  const parsed = parseArgentinaMobile(raw);
  return parsed.ok ? parsed.display : null;
}
