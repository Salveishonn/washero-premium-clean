import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const reservasSearchSchema = z.object({
  booking: z.string().uuid().optional(),
});

export const Route = createFileRoute("/admin/reservas")({
  validateSearch: reservasSearchSchema,
  beforeLoad: ({ search }) => {
    if (search.booking) {
      throw redirect({
        to: "/admin/reservas/$bookingId",
        params: { bookingId: search.booking },
      });
    }
    throw redirect({
      to: "/admin",
      search: {
        view: "list" as const,
      },
    });
  },
  component: () => null,
});
