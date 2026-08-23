import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const reservasSearchSchema = z.object({
  booking: z.string().uuid().optional(),
});

export const Route = createFileRoute("/admin/reservas")({
  validateSearch: reservasSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin",
      search: {
        view: "list" as const,
        booking: search.booking,
      },
    });
  },
  component: () => null,
});
