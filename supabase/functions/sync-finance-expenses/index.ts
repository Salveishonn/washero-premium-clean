/**
 * Sync Google Forms responses (Sheet tab Respuestas_Form) into finance_expenses.
 *
 * Auth:
 * - Admin JWT (owner/admin) for "Sincronizar ahora"
 * - OR x-internal-secret matching FINANCE_SYNC_SECRET for pg_cron
 *
 * Secrets:
 * - GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
 * - GOOGLE_SHEETS_SPREADSHEET_ID
 * - FINANCE_SYNC_SECRET (optional, for cron)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";
import { isValidWorkerSecret } from "../_shared/whatsapp-agent/worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const FINANCE_SYNC_SECRET = Deno.env.get("FINANCE_SYNC_SECRET") ?? "";
const SPREADSHEET_ID =
  Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? "1OqtH84vsW9MM1ZcNtExJn-nZwE0Mif95t7y9n6zBE-E";
const SHEET_RANGE = Deno.env.get("GOOGLE_SHEETS_RANGE") ?? "Respuestas_Form";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type ExpensePayer = "salva" | "moru" | "washero";

type ParsedExpense = {
  expense_date: string;
  payer: ExpensePayer;
  concept: string;
  category: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  sheet_row_key: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizePayer(raw: string): ExpensePayer | null {
  const v = raw.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v === "salva" || v === "salvador") return "salva";
  if (v === "moru" || v === "mauro") return "moru";
  if (v === "washero" || v === "empresa" || v === "negocio" || v === "business") return "washero";
  return null;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Accepts d/m/yyyy, dd/mm/yyyy, yyyy-mm-dd */
function parseExpenseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const m = String(Number(dmy[2])).padStart(2, "0");
    const d = String(Number(dmy[1])).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function looksNumeric(raw: string): boolean {
  return parseAmount(raw) != null && /[\d]/.test(raw);
}

function buildRowKey(timestamp: string, payer: string, amount: number, date: string, concept: string): string {
  return [timestamp.trim(), payer, String(amount), date, concept.trim().toLowerCase()].join("|");
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const unsigned = `${encodedHeader}.${encodedClaim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;

  const tokenRes = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`google_token_failed: ${tokenRes.status} ${text.slice(0, 200)}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("google_token_missing");
  return tokenJson.access_token;
}

async function fetchSheetValues(accessToken: string): Promise<string[][]> {
  const encodedRange = encodeURIComponent(SHEET_RANGE);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sheets_fetch_failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
}

function colIndex(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

function parseSheetRows(values: string[][]): { rows: ParsedExpense[]; skipped: number } {
  if (values.length < 2) return { rows: [], skipped: 0 };

  const headers = values[0]!.map((h) => normalizeHeader(String(h ?? "")));
  const idxTimestamp = colIndex(headers, "marca_temporal", "timestamp", "marca_de_tiempo");
  const idxFecha = colIndex(headers, "fecha");
  const idxPayer = colIndex(headers, "quien_pago", "quien_pago_", "payer", "pago");
  const idxConcept = colIndex(headers, "concepto", "concept", "descripcion", "description");
  const idxCategory = colIndex(headers, "categoria", "category");
  const idxAmount = colIndex(headers, "monto", "amount", "importe");
  const idxMethod = colIndex(headers, "medio_de_pago", "medio_pago", "payment_method", "pago_medio");
  const idxNotes = colIndex(headers, "notas", "notes", "nota", "observaciones");

  const rows: ParsedExpense[] = [];
  let skipped = 0;

  for (let i = 1; i < values.length; i++) {
    const raw = values[i] ?? [];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue;

    const timestamp = cell(raw, idxTimestamp) || `row-${i + 1}`;
    let concept = cell(raw, idxConcept);
    let category = cell(raw, idxCategory);
    let amountRaw = cell(raw, idxAmount);
    const payerRaw = cell(raw, idxPayer);
    const method = cell(raw, idxMethod);
    const notes = cell(raw, idxNotes);
    const fechaRaw = cell(raw, idxFecha);

    // Historic form quirk: sometimes category lands in concept and amount in category.
    if ((!amountRaw || !looksNumeric(amountRaw)) && looksNumeric(category)) {
      amountRaw = category;
      category = concept;
      concept = "";
    }
    if ((!amountRaw || !looksNumeric(amountRaw)) && looksNumeric(concept) && !looksNumeric(category)) {
      amountRaw = concept;
      concept = "";
    }

    const payer = normalizePayer(payerRaw);
    const amount = parseAmount(amountRaw);
    const expenseDate = parseExpenseDate(fechaRaw);

    if (!payer || amount == null || !expenseDate) {
      skipped++;
      continue;
    }

    // If category empty but concept looks like a known category label, treat as category.
    if (!category && concept && !notes) {
      // keep concept as-is; category may stay empty
    }

    rows.push({
      expense_date: expenseDate,
      payer,
      concept,
      category,
      amount,
      payment_method: method || null,
      notes: notes || null,
      sheet_row_key: buildRowKey(timestamp, payer, amount, expenseDate, concept || category),
    });
  }

  return { rows, skipped };
}

async function authorize(req: Request): Promise<"admin" | "cron" | null> {
  const cronSecret = req.headers.get("x-internal-secret");
  if (cronSecret && (await isValidWorkerSecret(cronSecret, FINANCE_SYNC_SECRET))) {
    return "cron";
  }

  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("authorization"),
  });
  if (!identity) return null;

  // Restrict to owner/admin (not operator)
  const { data: row } = await admin
    .from("admin_users")
    .select("role")
    .eq("id", identity.adminId)
    .maybeSingle();
  if (!row || !["owner", "admin"].includes(row.role ?? "")) return null;
  return "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authMode = await authorize(req);
  if (!authMode) return json({ ok: false, error: "forbidden" }, 403);

  const saRaw = Deno.env.get("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON");
  if (!saRaw) {
    return json({ ok: false, error: "missing_google_service_account" }, 500);
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(saRaw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) throw new Error("invalid_sa");
    // Google JSON often has \n escaped
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  } catch {
    return json({ ok: false, error: "invalid_google_service_account" }, 500);
  }

  try {
    const accessToken = await getGoogleAccessToken(sa);
    const values = await fetchSheetValues(accessToken);
    const { rows, skipped } = parseSheetRows(values);

    if (rows.length === 0) {
      return json({
        ok: true,
        upserted: 0,
        skipped,
        total_sheet_rows: Math.max(0, values.length - 1),
        auth: authMode,
      });
    }

    const nowIso = new Date().toISOString();
    const payload = rows.map((r) => ({
      ...r,
      source: "sheet" as const,
      synced_at: nowIso,
    }));

    const allKeys = payload.map((r) => r.sheet_row_key).filter(Boolean);
    const protectedKeys = new Set<string>();
    const KEY_CHUNK = 200;
    for (let i = 0; i < allKeys.length; i += KEY_CHUNK) {
      const chunk = allKeys.slice(i, i + KEY_CHUNK);
      const { data: blocked } = await admin
        .from("finance_expenses")
        .select("sheet_row_key, admin_override, deleted_at, source")
        .in("sheet_row_key", chunk);
      for (const row of blocked ?? []) {
        const key = String(row.sheet_row_key ?? "");
        if (!key) continue;
        if (row.source === "admin" || row.admin_override || row.deleted_at) protectedKeys.add(key);
      }
    }

    const filtered = payload.filter((r) => !protectedKeys.has(r.sheet_row_key));

    // Upsert in chunks to stay under payload limits
    const CHUNK = 200;
    let upserted = 0;
    for (let i = 0; i < filtered.length; i += CHUNK) {
      const chunk = filtered.slice(i, i + CHUNK);
      const { error, count } = await admin.from("finance_expenses").upsert(chunk, {
        onConflict: "sheet_row_key",
        count: "exact",
      });
      if (error) {
        console.error("[sync-finance-expenses] upsert", error);
        return json({ ok: false, error: "upsert_failed", detail: error.message }, 500);
      }
      upserted += count ?? chunk.length;
    }

    return json({
      ok: true,
      upserted,
      skipped,
      total_sheet_rows: values.length - 1,
      auth: authMode,
    });
  } catch (err) {
    console.error("[sync-finance-expenses]", err);
    return json(
      {
        ok: false,
        error: "sync_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
