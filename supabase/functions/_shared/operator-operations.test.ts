import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adminOverrideFromAuthRole,
  formatOperatorIssueNote,
  parseOperatorUpdateRequest,
  validateClientEventId,
} from "./operator-operations.ts";

Deno.test("new commands require client_event_id", () => {
  const missing = parseOperatorUpdateRequest({
    booking_id: "b1",
    command: "start_travel",
  });
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.code, "missing_client_event_id");

  const ok = parseOperatorUpdateRequest({
    booking_id: "b1",
    command: "start_travel",
    client_event_id: "abc-123",
    actor_id: "forged",
    staff_id: "forged",
    operator_id: "forged",
    admin_override: true,
    role: "owner",
    is_admin: true,
  });
  assertEquals(ok.ok, true);
  if (ok.ok && ok.kind === "command") {
    assertEquals(ok.command, "start_travel");
    assertEquals(ok.clientEventId, "abc-123");
    assertEquals(ok.legacyMode, false);
  }
});

Deno.test("legacy actions still parse without client_event_id", () => {
  const start = parseOperatorUpdateRequest({ booking_id: "b1", action: "start" });
  assertEquals(start.ok, true);
  if (start.ok && start.kind === "legacy") {
    assertEquals(start.action, "start");
    assertEquals(start.command, "start_wash");
    assertEquals(start.legacyMode, false);
    assertEquals(start.clientEventId, null);
  }

  const complete = parseOperatorUpdateRequest({
    booking_id: "b1",
    action: "complete",
    mark_paid: true,
  });
  assertEquals(complete.ok, true);
  if (complete.ok && complete.kind === "legacy") {
    assertEquals(complete.command, "complete_wash");
    assertEquals(complete.legacyMode, true);
    assertEquals(complete.markPaid, true);
  }

  const paid = parseOperatorUpdateRequest({ booking_id: "b1", action: "mark_paid" });
  assertEquals(paid.ok, true);
  if (paid.ok && paid.kind === "legacy") {
    assertEquals(paid.action, "mark_paid");
    assertEquals(paid.command, null);
  }
});

Deno.test("client_event_id rejects empty and oversized values", () => {
  assertEquals(validateClientEventId("  "), null);
  assertEquals(validateClientEventId("ok"), "ok");
  assertEquals(validateClientEventId("x".repeat(201)), null);
});

Deno.test("unknown commands and impersonation fields are rejected or ignored", () => {
  const unknown = parseOperatorUpdateRequest({
    booking_id: "b1",
    command: "self_assign",
    client_event_id: "abc",
  });
  assertEquals(unknown.ok, false);
  if (!unknown.ok) assertEquals(unknown.code, "invalid_command");

  const issue = parseOperatorUpdateRequest({
    booking_id: "b1",
    action: "report_issue",
    issue_note: "cliente ausente",
    admin_override: true,
    role: "admin",
  });
  assertEquals(issue.ok, true);
  if (issue.ok && issue.kind === "legacy") {
    assertEquals(issue.command, "report_incident");
    assertEquals(issue.legacyMode, true);
    assertEquals(issue.issueNote, "cliente ausente");
  }
});

Deno.test("admin override is derived only from authenticated role", () => {
  assertEquals(adminOverrideFromAuthRole("operator"), false);
  assertEquals(adminOverrideFromAuthRole("owner"), true);
  assertEquals(adminOverrideFromAuthRole("admin"), true);
  assertEquals(adminOverrideFromAuthRole(null), false);
});

Deno.test("issue note prefix matches legacy operator_notes formatting", () => {
  const at = new Date("2026-09-22T10:00:00.000Z");
  const formatted = formatOperatorIssueNote("cliente ausente", at);
  assertEquals(formatted.startsWith("[Operador "), true);
  assertEquals(formatted.endsWith("] cliente ausente"), true);
});
