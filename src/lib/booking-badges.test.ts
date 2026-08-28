import { describe, expect, it } from "vitest";
import { BOOKING_SOURCES, bookingSourceLabels } from "./booking-badges";

describe("booking source badges", () => {
  it("includes whatsapp_agent with a label", () => {
    expect(BOOKING_SOURCES).toContain("whatsapp_agent");
    expect(bookingSourceLabels.whatsapp_agent).toBe("WhatsApp");
  });
});
