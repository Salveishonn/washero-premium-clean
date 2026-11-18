import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffTeamPanel } from "@/components/admin/drivers/StaffTeamPanel";
import { AssignmentRulesPanel } from "@/components/admin/drivers/AssignmentRulesPanel";
import { DriversMap } from "@/components/admin/drivers/DriversMap";
import { useMyStaff } from "@/hooks/use-staff";
import { STAFF_QUERY_KEYS, fetchStaffMembers } from "@/lib/staff";

const TABS = ["equipo", "reglas", "mapa"] as const;

const driversSearchSchema = z.object({
  tab: z.enum(TABS).optional(),
});

export const Route = createFileRoute("/admin/drivers")({
  validateSearch: driversSearchSchema,
  component: DriversPage,
});

function DriversPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? "equipo";
  const me = useMyStaff();
  const members = useQuery({ queryKey: STAFF_QUERY_KEYS.members, queryFn: fetchStaffMembers });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Drivers</h1>
        <p className="text-sm text-muted-foreground">
          Alta y baja del equipo, reglas de asignación automática y ubicación en vivo.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as (typeof TABS)[number] } })}>
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
          <TabsTrigger value="equipo">Equipo</TabsTrigger>
          <TabsTrigger value="reglas">Reglas</TabsTrigger>
          <TabsTrigger value="mapa">Mapa</TabsTrigger>
        </TabsList>
        <TabsContent value="equipo" className="mt-4">
          <StaffTeamPanel
            members={members.data ?? []}
            loading={members.isLoading}
            myStaffId={me.staffId}
            myRole={me.role}
          />
          {members.error ? (
            <p className="mt-2 text-sm text-destructive">
              No se pudo cargar el equipo: {(members.error as Error).message}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="reglas" className="mt-4">
          <AssignmentRulesPanel members={members.data ?? []} />
        </TabsContent>
        <TabsContent value="mapa" className="mt-4">
          {tab === "mapa" ? <DriversMap members={members.data ?? []} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
