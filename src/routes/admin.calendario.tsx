import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/calendario")({
  beforeLoad: () => {
    throw redirect({
      to: "/admin",
      search: { view: "day" as const },
    });
  },
  component: () => null,
});
