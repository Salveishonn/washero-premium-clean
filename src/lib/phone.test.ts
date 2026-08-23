import { describe, expect, it } from "vitest";
import { parseArgentinaMobile } from "./phone";

describe("parseArgentinaMobile", () => {
  it("normalizes +54 9 11, 54911, 11, 011, and 15 to the same display", () => {
    const expected = "+54 9 11 1234-5678";
    const inputs = [
      "+54 9 11 1234-5678",
      "5491112345678",
      "+5491112345678",
      "11 1234-5678",
      "1112345678",
      "01112345678",
      "15 1234-5678",
      "1512345678",
    ];
    for (const input of inputs) {
      const parsed = parseArgentinaMobile(input);
      expect(parsed.ok, input).toBe(true);
      if (parsed.ok) {
        expect(parsed.display, input).toBe(expected);
        expect(parsed.e164).toBe("+5491112345678");
        expect(parsed.national).toBe("1112345678");
      }
    }
  });

  it("includes historic lookup variants", () => {
    const parsed = parseArgentinaMobile("1112345678");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lookupVariants).toEqual(
      expect.arrayContaining([
        "1112345678",
        "01112345678",
        "5491112345678",
        "+5491112345678",
        "+54 9 11 1234-5678",
        "1512345678",
      ]),
    );
  });

  it("accepts interior mobiles with 3-digit area", () => {
    const parsed = parseArgentinaMobile("0221151234567");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.national).toBe("2211234567");
    expect(parsed.display).toBe("+54 9 221 123-4567");
  });

  it("rejects too-short and empty values", () => {
    expect(parseArgentinaMobile("").ok).toBe(false);
    expect(parseArgentinaMobile("12345").ok).toBe(false);
    expect(parseArgentinaMobile("abc").ok).toBe(false);
  });
});
