/** Tiny helpers so outbound WhatsApp does not import the full booking engine. */

export function pick(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = obj;
    let ok = true;
    for (const k of parts) {
      if (cur == null) {
        ok = false;
        break;
      }
      cur = cur[k];
    }
    if (ok && cur != null && cur !== "") {
      if (typeof cur === "string" || typeof cur === "number") return String(cur);
    }
  }
  return null;
}

export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/@.*$/, "");
  s = s.replace(/^whatsapp:/i, "");
  s = s.replace(/[^\d+]/g, "");
  if (!s) return null;
  return s;
}
