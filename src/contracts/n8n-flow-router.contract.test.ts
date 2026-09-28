import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { REPO_ROOT } from "./read-repo-file";

describe("n8n flow router script tests", () => {
  it("passes the standalone Flow Router assertions", () => {
    execFileSync(process.execPath, [resolve(REPO_ROOT, "scripts/n8n-washero-flow-router.test.mjs")], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    expect(true).toBe(true);
  });
});
