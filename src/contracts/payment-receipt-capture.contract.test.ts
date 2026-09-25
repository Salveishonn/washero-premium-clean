import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const CAPTURE = "supabase/functions/_shared/payment-receipt-capture.ts";
const COMPENSATION = "supabase/functions/_shared/payment-receipt-capture-compensation.ts";
const WRAPPER = "supabase/functions/_shared/payment-receipts.ts";

describe("payment receipt capture compensation contracts", () => {
  const capture = readRepoFile(CAPTURE);
  const compensation = readRepoFile(COMPENSATION);
  const wrapper = readRepoFile(WRAPPER);

  it("compensates only the exact uploaded path after an unambiguous insert failure", () => {
    expect(capture).toContain("cleanupUploadedReceiptObject");
    expect(capture).toContain("shouldCompensateReceiptUpload");
    expect(capture).toContain("remove: ports.removeExact");
    expect(capture).toContain("path: uploadedPath");
    expect(wrapper).toContain(".insert(row)");
    expect(wrapper).not.toMatch(/\.insert\([\s\S]*?\)\s*\.select\(/);
    expect(wrapper).not.toMatch(/insert\([\s\S]*?\)\s*\.maybeSingle\(/);
  });

  it("never lists prefixes or accepts client delete targets", () => {
    expect(compensation).not.toMatch(/\.list\(/);
    expect(compensation).toContain("remove([opts.path])");
    expect(compensation).not.toMatch(/list\(<booking-prefix>\)/);
    expect(capture).not.toMatch(/storage\.from\([^)]+\)\.list\(/);
    expect(wrapper).toContain("remove(exactPaths)");
    expect(wrapper).not.toMatch(/body\.(paths|receipt_ids|prefix|force)/);
  });

  it("does not log PII or storage paths in compensation diagnostics", () => {
    const insertLog = capture.slice(capture.indexOf('stage: "receipt_insert_failed"'));
    const block = insertLog.slice(0, insertLog.indexOf("});") + 3);
    expect(block).toContain("storage_compensation_attempted");
    expect(block).toContain("storage_compensation_succeeded");
    expect(block).not.toContain("customer_phone");
    expect(block).not.toContain("storage_path");
    expect(block).not.toContain("media_url");
    expect(block).not.toContain("raw_payload");
    expect(block).not.toContain("file_name");
    expect(block).not.toContain("phone");
  });
});
