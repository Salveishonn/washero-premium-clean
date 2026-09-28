import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRepoFile } from "./read-repo-file";

const FRONTEND_ROOTS = ["src/components/admin", "src/routes", "src/lib"];
const EDGE = "supabase/functions/admin-booking-proofs/index.ts";
const HELPER = "supabase/functions/_shared/admin-booking-proofs.ts";

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

function frontendFiles(): string[] {
  return FRONTEND_ROOTS.flatMap((rel) => walk(join(REPO_ROOT, rel)))
    .map((full) => relative(REPO_ROOT, full).replaceAll("\\", "/"))
    .filter((rel) => rel.endsWith(".ts") || rel.endsWith(".tsx"))
    .filter((rel) => !rel.includes(".test.") && !rel.includes("/test/"));
}

describe("admin booking control tower security contract", () => {
  it("proof edge function requires admin JWT and never returns storage_path", () => {
    const edge = readRepoFile(EDGE);
    const helper = readRepoFile(HELPER);
    expect(edge).toContain("getAdminHardDeleteGate");
    expect(edge).toContain("booking_id");
    expect(edge).not.toMatch(/body\.storage_bucket|body\.storage_path|body\.bucket/);
    expect(helper).toContain("preview_error");
    expect(helper).toContain("signed_url");
    expect(readRepoFile("supabase/config.toml")).toContain("[functions.admin-booking-proofs]");
  });

  it("admin frontend does not call Storage SDK for booking-proofs", () => {
    for (const rel of frontendFiles()) {
      const src = readRepoFile(rel);
      expect(src, rel).not.toMatch(/storage\.from\(\s*["']booking-proofs["']\s*\)[\s\S]{0,200}\.createSignedUrl/);
      expect(src, rel).not.toMatch(/storage\.from\(\s*["']booking-proofs["']\s*\)[\s\S]{0,200}\.download/);
      if (rel.startsWith("src/components/admin/booking-detail/") || rel === "src/lib/admin-booking-detail.ts") {
        expect(src, rel).not.toContain("storage_path");
      }
    }
  });

  it("admin UI no longer directly sets in_progress or completed", () => {
    const bookings = readRepoFile("src/components/admin/bookings.tsx");
    const actions = readRepoFile("src/components/admin/booking-detail/BookingAdminActions.tsx");
    expect(bookings).toContain("isAdminOperationalBypassStatus");
    expect(bookings).not.toMatch(/booking_status:\s*"in_progress"/);
    expect(bookings).not.toMatch(/booking_status:\s*"completed"/);
    expect(bookings).not.toContain("Iniciar");
    expect(bookings).not.toContain("Completar");
    expect(actions).not.toMatch(/booking_status:\s*"in_progress"/);
    expect(actions).not.toMatch(/booking_status:\s*"completed"/);
    expect(actions).not.toContain("> Iniciar");
    expect(actions).not.toContain("> Completar");
  });

  it("does not approve receipts or hard-delete bookings from the control tower", () => {
    const detailDir = walk(join(REPO_ROOT, "src/components/admin/booking-detail"))
      .map((full) => relative(REPO_ROOT, full).replaceAll("\\", "/"))
      .filter((rel) => rel.endsWith(".ts") || rel.endsWith(".tsx"));
    for (const rel of detailDir) {
      if (rel.includes(".test.")) continue;
      const src = readRepoFile(rel);
      expect(src, rel).not.toContain("approve-payment-receipt");
      expect(src, rel).not.toMatch(/\.from\(\s*["']bookings["']\s*\)[\s\S]{0,200}\.delete\s*\(/);
      expect(src, rel).not.toContain("complete_wash");
    }
    const actions = readRepoFile("src/components/admin/booking-detail/BookingAdminActions.tsx");
    expect(actions).toContain("deleteBooking(");
    expect(actions).not.toMatch(/\.from\(\s*["']bookings["']\s*\)[\s\S]{0,200}\.delete\s*\(/);
  });
});
