import type { Booking } from "@/components/admin/bookings";
import { DayTimeline } from "@/components/admin/ops/DayTimeline";
import { OperationsDayFilters } from "@/components/admin/ops/OperationsDayFilters";
import { OperationsDaySummary } from "@/components/admin/ops/OperationsDaySummary";
import {
  hubBuildRowState,
  hubDaySummary,
  hubOperatorLabel,
  indexOperationsByBookingId,
  matchesHubFilter,
  selectNextBookingId,
  type HubFilter,
  type HubOperationInput,
  type HubReceiptInput,
  type HubStaffInput,
} from "@/lib/admin-operations-hub";

function booking(overrides: Partial<Booking> & { id: string; scheduled_time: string }): Booking {
  return {
    customer_id: "c1",
    customer_name: "Cliente",
    customer_phone: "1134567890",
    customer_email: null,
    address: "Calle Falsa 123, no debe verse",
    neighborhood: "Nordelta",
    vehicle_type: "Auto",
    service_id: "s1",
    service_name: "Lavado Completo",
    scheduled_date: "2026-09-28",
    duration_minutes: 60,
    payment_method: "Efectivo",
    payment_status: "pending",
    booking_status: "confirmed",
    booking_source: "admin",
    assigned_operator_id: "op-1",
    assigned_vehicle_label: "Van 1",
    price: 15000,
    notes: null,
    created_at: "2026-09-27T12:00:00Z",
    updated_at: "2026-09-27T12:00:00Z",
    ...overrides,
  };
}

const FIXTURE_BOOKINGS: Booking[] = [
  booking({
    id: "u",
    scheduled_time: "09:00:00",
    customer_name: "Ana Unassigned",
    assigned_operator_id: null,
    assigned_vehicle_label: null,
  }),
  booking({ id: "r", scheduled_time: "10:00:00", customer_name: "Bruno En camino" }),
  booking({ id: "w", scheduled_time: "11:00:00", customer_name: "Carla Lavando" }),
  booking({ id: "p", scheduled_time: "12:00:00", customer_name: "Diego Proof" }),
  booking({ id: "i", scheduled_time: "13:00:00", customer_name: "Elena Incidente" }),
  booking({
    id: "c",
    scheduled_time: "14:00:00",
    customer_name: "Facundo Cerrado",
    payment_status: "paid",
    booking_status: "completed",
  }),
  booking({
    id: "t",
    scheduled_time: "15:00:00",
    customer_name: "Gisela Transfer",
    payment_method: "Transferencia",
    payment_status: "pending",
  }),
];

const FIXTURE_OPS: HubOperationInput[] = [
  { booking_id: "u", phase: "unassigned" },
  { booking_id: "r", phase: "en_route" },
  { booking_id: "w", phase: "wash_in_progress" },
  { booking_id: "p", phase: "proof_required" },
  { booking_id: "i", phase: "incident" },
  { booking_id: "c", phase: "closed" },
  { booking_id: "t", phase: "accepted" },
];

const FIXTURE_RECEIPTS: HubReceiptInput[] = [
  { booking_id: "t", status: "pending_review", created_at: "2026-09-28T09:00:00Z" },
];

const FIXTURE_STAFF: HubStaffInput[] = [{ id: "op-1", email: "op@washero.ar", role: "operator", active: true }];

/** Presentational fixture used by visual/component review. Not a second Control Tower. */
export function OperationsHubVisualFixture({
  filter = "all",
  onFilterChange,
}: {
  filter?: HubFilter;
  onFilterChange?: (filter: HubFilter) => void;
}) {
  const operationsById = indexOperationsByBookingId(FIXTURE_OPS);
  const staffById = new Map(FIXTURE_STAFF.map((s) => [s.id, s]));
  const rows = FIXTURE_BOOKINGS.map((item) =>
    hubBuildRowState({
      booking: item,
      operation: operationsById.get(item.id) ?? null,
      receipts: FIXTURE_RECEIPTS.filter((receipt) => receipt.booking_id === item.id),
      opsLoad: "ok",
      receiptsLoad: "ok",
    }),
  );
  const rowsById = new Map(rows.map((row) => [row.bookingId, row]));
  const operatorLabelById = new Map(
    FIXTURE_BOOKINGS.map((item) => [item.id, hubOperatorLabel(item.assigned_operator_id, staffById, "ok")]),
  );
  const visible = FIXTURE_BOOKINGS.filter((item) => {
    const row = rowsById.get(item.id);
    return row ? matchesHubFilter(row, filter) : false;
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 overflow-x-hidden p-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Operación</h1>
        <p className="text-sm text-muted-foreground">Fixture local · no son datos de producción</p>
      </header>
      <OperationsDaySummary title="Hoy" summary={hubDaySummary(rows)} />
      <OperationsDayFilters value={filter} onChange={onFilterChange ?? (() => undefined)} />
      <DayTimeline
        dateIso="2026-09-28"
        bookings={visible}
        rowsById={rowsById}
        operationsById={operationsById}
        operatorLabelById={operatorLabelById}
        nextBookingId={selectNextBookingId(rows)}
        opsLoad="ok"
        onCreate={() => undefined}
      />
    </div>
  );
}

export const HUB_VISUAL_FIXTURE_BOOKINGS = FIXTURE_BOOKINGS;
