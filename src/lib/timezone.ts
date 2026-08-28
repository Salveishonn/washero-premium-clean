export const BUENOS_AIRES_TZ = "America/Argentina/Buenos_Aires";

/** Calendar date in America/Argentina/Buenos_Aires as YYYY-MM-DD. */
export function todayBuenosAiresIso(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: BUENOS_AIRES_TZ });
}

export function todayIso(now = new Date()): string {
  return todayBuenosAiresIso(now);
}

/** Add calendar days to a YYYY-MM-DD date without UTC shifting the civil day. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
