import { describe, expect, it } from "vitest";
import { defaultMetaReviewTemplateName } from "@/lib/meta-review";

describe("meta-review helpers", () => {
  it("builds Meta-safe default template names", () => {
    const name = defaultMetaReviewTemplateName(new Date("2026-09-10T20:00:00.000Z"));
    expect(name).toMatch(/^washero_meta_review_\d+$/);
    expect(name.includes(" ")).toBe(false);
    expect(name).toBe(name.toLowerCase());
  });
});
