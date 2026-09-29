import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

describe("safe rebook contract", () => {
  it("keeps rebook as a pure template and the create form on the canonical mutation", () => {
    const helper = readRepoFile("src/lib/booking-rebook.ts");
    const form = readRepoFile("src/components/admin/bookings.tsx");
    expect(helper).not.toContain("supabase");
    expect(helper).not.toContain(".insert");
    expect(helper).not.toContain("...input");
    expect(helper).not.toContain("...source");
    expect(helper).not.toContain("functions.invoke");
    expect(helper).not.toContain("price:");
    expect(helper).not.toContain("notes:");
    expect(form).toContain("invokeCreateAdminBooking");
    expect(form).toContain("AdminCreateBookingDialog");
    expect(form).not.toContain('.from("bookings").insert');
    expect(readRepoFile("src/components/admin/customer-detail/AdminCustomerDossier.tsx")).toContain(
      "Volver a reservar",
    );
    expect(readRepoFile("src/components/admin/booking-detail/BookingAdminActions.tsx")).toContain(
      "Volver a reservar",
    );
    expect(readRepoFile("src/components/admin/booking-detail/BookingAdminActions.tsx")).toContain(
      "AdminCreateBookingDialog",
    );
  });
});
