import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRepoFile } from "./read-repo-file";

const EDGE = "supabase/functions/admin-delete-booking/index.ts";
const HELPER = "supabase/functions/_shared/booking-hard-delete.ts";
const GATE = "supabase/functions/_shared/admin-gate.ts";
const CONFIG = "supabase/config.toml";
const CLIENT = "src/lib/admin-delete.ts";
const HEALTH = "src/routes/admin.configuracion.tsx";
const SUBSCRIPTION = "supabase/functions/create-subscription-booking/index.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".output" || entry === "dist") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

function isProductionFrontend(file: string): boolean {
  const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
  if (!rel.startsWith("src/")) return false;
  if (rel.includes(".test.")) return false;
  if (rel.includes("/test/")) return false;
  if (rel.endsWith(".d.ts")) return false;
  return rel.endsWith(".ts") || rel.endsWith(".tsx");
}

function hasChainedBookingsDelete(source: string): boolean {
  const re = /\.from\(\s*["']bookings["']\s*\)([\s\S]{0,400})/g;
  for (const match of source.matchAll(re)) {
    const window = match[1] ?? "";
    const deleteIdx = window.search(/\.delete\s*\(/);
    if (deleteIdx < 0) continue;
    const nextFrom = window.search(/\.from\s*\(/);
    if (nextFrom >= 0 && nextFrom < deleteIdx) continue;
    return true;
  }
  return false;
}

function hasChainedTableDelete(source: string, table: string): boolean {
  const re = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)([\\s\\S]{0,400})`, "g");
  for (const match of source.matchAll(re)) {
    const window = match[1] ?? "";
    const deleteIdx = window.search(/\.delete\s*\(/);
    if (deleteIdx < 0) continue;
    const nextFrom = window.search(/\.from\s*\(/);
    if (nextFrom >= 0 && nextFrom < deleteIdx) continue;
    return true;
  }
  return false;
}

function hasBookingProofsRemove(source: string): boolean {
  return /storage\.from\(\s*["']booking-proofs["']\s*\)[\s\S]{0,200}\.remove\s*\(/.test(source) ||
    /\.from\(\s*["']booking-proofs["']\s*\)[\s\S]{0,200}\.remove\s*\(/.test(source);
}

function hasPaymentReceiptsStorageRemove(source: string): boolean {
  return /storage\.from\(\s*["']payment-receipts["']\s*\)[\s\S]{0,200}\.remove\s*\(/.test(source) ||
    /\.from\(\s*["']payment-receipts["']\s*\)[\s\S]{0,200}\.remove\s*\(/.test(source);
}

describe("admin-delete-booking edge function", () => {
  const edge = readRepoFile(EDGE);
  const helper = readRepoFile(HELPER);
  const gate = readRepoFile(GATE);

  it("requires JWT admin_users owner/admin and rejects operators", () => {
    expect(edge).toContain("getAdminHardDeleteGate");
    expect(gate).toContain("userClient.auth.getUser()");
    expect(gate).toContain('from("admin_users")');
    expect(helper).toContain('role !== "owner" && role !== "admin"');
    expect(helper).toContain('code: "unauthorized"');
    expect(helper).toContain('code: "forbidden"');
    expect(edge).not.toMatch(/body\.(is_admin|role|operator)/);
  });

  it("accepts only booking_id and derives storage paths from the trusted UUID", () => {
    expect(helper).toContain("parseDeleteBookingRequest");
    expect(edge).toContain("parseDeleteBookingRequest(body)");
    expect(edge).not.toMatch(/body\.(storage_path|path|prefix|is_test|force|override|cleanup_mode)/);
    expect(helper).toContain("bookingProofPrefix");
    expect(helper).toContain("enumerateBookingProofPaths");
    expect(helper).toContain("isInternalTestBooking");
  });

  it("runs the financial guard before any destructive cleanup", () => {
    const fn = helper.slice(helper.indexOf("export async function runCanonicalBookingHardDelete"));
    const blockIdx = fn.indexOf("financial_evidence_exists");
    const receiptIdx = fn.indexOf("runPaymentReceiptCleanup");
    const proofIdx = fn.indexOf("enumerateBookingProofPaths");
    const invoiceIdx = fn.indexOf("deleteInvoices");
    const bookingIdx = fn.indexOf("const deleted = await ports.deleteBooking(bookingId)");
    expect(blockIdx).toBeGreaterThan(0);
    expect(receiptIdx).toBeGreaterThan(blockIdx);
    expect(proofIdx).toBeGreaterThan(receiptIdx);
    expect(invoiceIdx).toBeGreaterThan(proofIdx);
    expect(bookingIdx).toBeGreaterThan(invoiceIdx);
  });

  it("deletes storage under the booking prefix before deleting the booking row", () => {
    expect(helper).toContain("removeProofObjects");
    expect(helper).toContain("deleteBooking");
    const storageIdx = helper.indexOf("if (listed.paths.length > 0)");
    const bookingIdx = helper.indexOf("const deleted = await ports.deleteBooking(bookingId)");
    expect(storageIdx).toBeGreaterThan(0);
    expect(bookingIdx).toBeGreaterThan(storageIdx);
    expect(edge).toContain("BOOKING_PROOFS_BUCKET");
    expect(edge).toContain("PAYMENT_RECEIPTS_BUCKET");
    expect(edge).toContain('from("bookings").delete()');
  });

  it("does not clean payment-receipts when the booking is already absent", () => {
    const fn = helper.slice(helper.indexOf("export async function runCanonicalBookingHardDelete"));
    const existsIdx = fn.indexOf("if (booking.exists)");
    const receiptIdx = fn.indexOf("runPaymentReceiptCleanup");
    const alreadyIdx = fn.indexOf('financialGuard = "already_deleted"');
    expect(existsIdx).toBeGreaterThan(0);
    expect(receiptIdx).toBeGreaterThan(existsIdx);
    expect(alreadyIdx).toBeGreaterThan(receiptIdx);
    expect(edge).not.toMatch(/\.is\(\s*["']booking_id["']\s*,\s*null\s*\)/);
  });

  it("is retryable when storage is already gone or the booking is already deleted", () => {
    expect(helper).toContain("already_deleted");
    expect(edge).toContain("isMissingStorageError");
    expect(helper).toContain("booking_delete_failed");
  });
});

describe("admin-delete-booking config", () => {
  it("registers the function with JWT verification", () => {
    const config = readRepoFile(CONFIG);
    expect(config).toContain("[functions.admin-delete-booking]");
    const block = config.split("[functions.admin-delete-booking]")[1]?.split("[")[0] ?? "";
    expect(block).toContain("verify_jwt = true");
  });
});

describe("production frontend hard-delete contract", () => {
  const files = walk(join(REPO_ROOT, "src")).filter(isProductionFrontend);

  it("has production frontend files to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("does not hard-delete bookings directly from production frontend code", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readRepoFile(relative(REPO_ROOT, file).replaceAll("\\", "/"));
      if (hasChainedBookingsDelete(source)) {
        offenders.push(relative(REPO_ROOT, file).replaceAll("\\", "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not remove booking-proofs objects from production frontend code", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readRepoFile(relative(REPO_ROOT, file).replaceAll("\\", "/"));
      if (hasBookingProofsRemove(source) || source.includes('storage.from("booking-proofs")')) {
        offenders.push(relative(REPO_ROOT, file).replaceAll("\\", "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not delete payment_receipts or payment-receipts storage from production frontend code", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const source = readRepoFile(rel);
      if (hasChainedTableDelete(source, "payment_receipts") || hasPaymentReceiptsStorageRemove(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("routes admin and HealthTab cleanup through the Edge Function", () => {
    const client = readRepoFile(CLIENT);
    const health = readRepoFile(HEALTH);
    expect(client).toContain('supabase.functions.invoke("admin-delete-booking"');
    expect(client).toContain("booking_id");
    expect(client).not.toMatch(/from\("bookings"\)\s*\.delete/);
    expect(client).not.toMatch(/from\("invoices"\)\s*\.delete/);
    expect(client).not.toMatch(/from\("booking_proof_media"\)/);
    expect(health).toContain("deleteBooking");
    expect(health).toContain("HEALTHCHECK_DELETE_ME_");
    expect(health).not.toMatch(/from\("bookings"\)\s*\.delete/);
  });
});

describe("documented server-side exceptions", () => {
  it("keeps subscription create-rollback as an internal pre-proof delete", () => {
    const source = readRepoFile(SUBSCRIPTION);
    expect(source).toContain("cannot have proof media yet");
    expect(source).toContain('from("bookings").delete()');
  });
});
