import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  loadGoogleMapsApi,
  MAPS_LOAD_ERROR_MESSAGES,
  parseMapsLoadFailure,
} from "@/lib/google-maps-loader";
import {
  STAFF_QUERY_KEYS,
  fetchStaffLocations,
  formatAgo,
  locationFreshness,
  staffDisplayName,
  type LocationFreshness,
  type StaffMember,
} from "@/lib/staff";
import { todayBuenosAiresIso } from "@/lib/operator";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G = any;

const DEFAULT_CENTER = { lat: -34.42, lng: -58.62 };
const COLORS: Record<LocationFreshness, string> = {
  live: "#16a34a",
  recent: "#f59e0b",
  stale: "#6b7280",
  off: "#9ca3af",
};

type TodayBooking = {
  id: string;
  customer_name: string;
  scheduled_time: string;
  address_lat: number | null;
  address_lng: number | null;
  assigned_operator_id: string | null;
  booking_status: string;
};

export function DriversMap({ members }: { members: StaffMember[] }) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<G>(null);
  const infoRef = useRef<G>(null);
  const markersRef = useRef<G[]>([]);
  const fittedRef = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const locations = useQuery({
    queryKey: STAFF_QUERY_KEYS.locations,
    queryFn: fetchStaffLocations,
    refetchInterval: 30_000,
  });

  const today = todayBuenosAiresIso();
  const bookings = useQuery({
    queryKey: ["admin", "drivers-map-bookings", today],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("bookings")
        .select("id,customer_name,scheduled_time,address_lat,address_lng,assigned_operator_id,booking_status")
        .eq("scheduled_date", today)
        .neq("booking_status", "cancelled");
      if (err) throw err;
      return (data ?? []) as TodayBooking[];
    },
    refetchInterval: 120_000,
  });

  // Live updates
  useEffect(() => {
    const channel = supabase
      .channel("staff-locations-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_locations" }, () => {
        qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.locations });
      })
      .subscribe();
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(tick);
    };
  }, [qc]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsApi()
      .then(() => {
        const google = (window as G).google;
        if (cancelled || !containerRef.current || !google?.maps) return;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
        });
        infoRef.current = new google.maps.InfoWindow();
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(MAPS_LOAD_ERROR_MESSAGES[parseMapsLoadFailure(err)]);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const drawn = useMemo(() => {
    return (locations.data ?? [])
      .filter((l) => memberById.has(l.staff_id) && memberById.get(l.staff_id)!.active)
      .map((l) => ({ loc: l, member: memberById.get(l.staff_id)!, fresh: locationFreshness(l, now) }));
  }, [locations.data, memberById, now]);

  useEffect(() => {
    const google = (window as G).google;
    const map = mapRef.current;
    if (state !== "ready" || !map || !google?.maps) return;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    let points = 0;

    for (const b of bookings.data ?? []) {
      if (b.address_lat == null || b.address_lng == null) continue;
      const pos = { lat: Number(b.address_lat), lng: Number(b.address_lng) };
      const marker = new google.maps.Marker({
        position: pos,
        map,
        zIndex: 1,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: b.assigned_operator_id ? "#3b82f6" : "#ef4444",
          fillOpacity: 0.9,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: `${b.scheduled_time.slice(0, 5)} · ${b.customer_name}`,
      });
      marker.addListener("click", () => {
        const driver = b.assigned_operator_id ? memberById.get(b.assigned_operator_id) : null;
        infoRef.current.setContent(
          `<div style="font-size:13px"><strong>${b.scheduled_time.slice(0, 5)}</strong> · ${escapeHtml(b.customer_name)}<br/>` +
            `Driver: ${driver ? escapeHtml(staffDisplayName(driver)) : "<span style='color:#ef4444'>sin asignar</span>"}<br/>` +
            `<a href="/admin/reservas/${b.id}">Ver reserva</a></div>`,
        );
        infoRef.current.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
      points += 1;
    }

    for (const { loc, member, fresh } of drawn) {
      const name = staffDisplayName(member);
      const pos = { lat: loc.lat, lng: loc.lng };
      const marker = new google.maps.Marker({
        position: pos,
        map,
        zIndex: 10,
        label: { text: name.slice(0, 2).toUpperCase(), color: "#fff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: COLORS[fresh],
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 3,
        },
        title: name,
      });
      marker.addListener("click", () => {
        infoRef.current.setContent(
          `<div style="font-size:13px"><strong>${escapeHtml(name)}</strong><br/>` +
            `${fresh === "off" ? "No comparte ubicación (última conocida)" : "Actualizado " + formatAgo(loc.updated_at)}` +
            `${loc.accuracy_m ? `<br/>Precisión ±${Math.round(loc.accuracy_m)} m` : ""}` +
            `${member.phone ? `<br/><a href="tel:${escapeHtml(member.phone)}">${escapeHtml(member.phone)}</a>` : ""}` +
            `<br/><a href="https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}" target="_blank" rel="noreferrer">Abrir en Maps</a></div>`,
        );
        infoRef.current.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
      points += 1;
    }

    if (points > 0 && !fittedRef.current) {
      fittedRef.current = true;
      if (points === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 48);
      }
    }
  }, [state, drawn, bookings.data, memberById]);

  function focus(lat: number, lng: number) {
    mapRef.current?.panTo({ lat, lng });
    mapRef.current?.setZoom(15);
  }

  const drivers = members.filter((m) => m.active);
  const locById = new Map((locations.data ?? []).map((l) => [l.staff_id, l]));

  return (
    <div className="space-y-3">
      <div className="relative h-[55dvh] min-h-72 overflow-hidden rounded-xl border border-border/60 bg-muted md:h-[60vh]">
        <div ref={containerRef} className="absolute inset-0" />
        {state === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {state === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend color={COLORS.live} label="En vivo (< 2 min)" />
        <Legend color={COLORS.recent} label="< 15 min" />
        <Legend color={COLORS.stale} label="Desactualizado / off" />
        <Legend color="#3b82f6" label="Reserva hoy asignada" small />
        <Legend color="#ef4444" label="Reserva hoy sin driver" small />
      </div>
      <div className="divide-y divide-border/60 rounded-xl border border-border/60">
        {drivers.map((m) => {
          const loc = locById.get(m.id);
          const fresh = locationFreshness(loc, now);
          return (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[fresh] }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{staffDisplayName(m)}</p>
                <p className="text-xs text-muted-foreground">
                  {loc ? (fresh === "off" ? `No comparte · última ${formatAgo(loc.updated_at, now)}` : formatAgo(loc.updated_at, now)) : "Nunca compartió ubicación"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!loc || state !== "ready"}
                onClick={() => loc && focus(loc.lat, loc.lng)}
              >
                <Crosshair className="mr-1 h-4 w-4" /> Ver
              </Button>
            </div>
          );
        })}
        {drivers.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No hay staff activo.</p> : null}
      </div>
    </div>
  );
}

function Legend({ color, label, small }: { color: string; label: string; small?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("rounded-full", small ? "h-2 w-2" : "h-3 w-3")} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
