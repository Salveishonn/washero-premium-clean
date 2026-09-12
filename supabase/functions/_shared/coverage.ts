// Coverage matching helpers shared by website + botmaker booking paths.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type CoverageZone = {
  id: string;
  name: string;
  aliases: string[];
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number;
  polygon_geojson: unknown | null;
  display_order: number;
  active: boolean;
};

export type CoverageMatch = {
  zone: CoverageZone | null;
  // "private_neighborhood" is never produced by matchZone() itself — booking-core.ts constructs
  // it directly for private-neighborhood address bookings, which resolve coverage from the
  // private_neighborhoods table instead of matching against a zone polygon/alias/radius.
  match_type: "polygon" | "alias" | "radius" | "none" | "private_neighborhood";
  distance_km: number | null;
};

export type CoverageAddressComponent = {
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
  types?: string[];
};

const LOCALITY_COMPONENT_TYPES = new Set([
  "locality",
  "sublocality",
  "sublocality_level_1",
  "neighborhood",
  "postal_town",
  "administrative_area_level_2",
]);

const REJECTED_BROAD_COMPONENT_TYPES = new Set(["administrative_area_level_1", "country"]);

export const fold = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,/#'"´`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Ray-casting on a GeoJSON Polygon or MultiPolygon (lng,lat coordinate order).
function pointInPolygon(lat: number, lng: number, geo: unknown): boolean {
  if (!geo || typeof geo !== "object") return false;
  const g = geo as { type?: string; coordinates?: unknown };
  if (!g.type) return false;
  const polys: number[][][][] =
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [];
  for (const poly of polys) {
    const ring = poly?.[0]; // outer ring; ignore holes for our use case
    if (!Array.isArray(ring)) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] ?? [];
      const [xj, yj] = ring[j] ?? [];
      if (
        typeof xi !== "number" ||
        typeof yi !== "number" ||
        typeof xj !== "number" ||
        typeof yj !== "number"
      ) {
        continue;
      }
      const intersect =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

export function extractLocalityCandidates(
  components: CoverageAddressComponent[] | null | undefined,
  extras: Array<string | null | undefined> = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const value = String(raw ?? "").trim();
    if (!value) return;
    const key = fold(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const component of components ?? []) {
    const types = Array.isArray(component.types) ? component.types : [];
    const isLocality = types.some((t) => LOCALITY_COMPONENT_TYPES.has(t));
    const isBroadOnly = !isLocality && types.some((t) => REJECTED_BROAD_COMPONENT_TYPES.has(t));
    if (!isLocality || isBroadOnly) continue;
    push(component.longText ?? component.long_name);
    push(component.shortText ?? component.short_name);
  }

  for (const extra of extras) push(extra);
  return out;
}

export async function loadActiveZones(admin: SupabaseClient): Promise<CoverageZone[]> {
  const { data } = await admin
    .from("coverage_zones")
    .select("id,name,aliases,center_lat,center_lng,radius_km,polygon_geojson,display_order,active")
    .eq("active", true)
    .order("display_order", { ascending: true });
  return (data ?? []) as CoverageZone[];
}

export function matchZone(
  zones: CoverageZone[],
  args: {
    lat?: number | null;
    lng?: number | null;
    neighborhood?: string | null;
    localityCandidates?: Array<string | null | undefined>;
  },
): CoverageMatch {
  const { lat, lng, neighborhood, localityCandidates } = args;

  // 1) polygon
  if (typeof lat === "number" && typeof lng === "number") {
    for (const z of zones) {
      if (z.polygon_geojson && pointInPolygon(lat, lng, z.polygon_geojson)) {
        return { zone: z, match_type: "polygon", distance_km: 0 };
      }
    }
  }

  // 2) exact normalized equality against locality-like candidates + aliases
  const candidates = [...(localityCandidates ?? []), neighborhood]
    .map((value) => fold(String(value ?? "")))
    .filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length > 0) {
    for (const z of zones) {
      const names = [z.name, ...(z.aliases ?? [])].map(fold).filter(Boolean);
      if (names.some((n) => uniqueCandidates.includes(n))) {
        return { zone: z, match_type: "alias", distance_km: null };
      }
    }
  }

  // 3) radius
  if (typeof lat === "number" && typeof lng === "number") {
    let best: { zone: CoverageZone; dist: number } | null = null;
    for (const z of zones) {
      if (typeof z.center_lat === "number" && typeof z.center_lng === "number") {
        const d = haversineKm(lat, lng, z.center_lat, z.center_lng);
        if (d <= Number(z.radius_km ?? 0) && (!best || d < best.dist)) {
          best = { zone: z, dist: d };
        }
      }
    }
    if (best) return { zone: best.zone, match_type: "radius", distance_km: best.dist };
  }
  return { zone: null, match_type: "none", distance_km: null };
}

/** Comma-split formatted addresses so "…, Tigre, Argentina" can alias-match. */
export function localityCandidatesFromText(
  ...values: Array<string | null | undefined>
): string[] {
  const extras: string[] = [];
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    extras.push(raw);
    for (const part of raw.split(",")) {
      const piece = part.trim();
      if (piece) extras.push(piece);
    }
  }
  return extractLocalityCandidates(undefined, extras);
}

/**
 * Street coverage for booking create: same alias/polygon/radius rules as
 * validate_service_area, plus an authenticated lock from that validation.
 * Production zones often have empty polygons/centers, so the lock is required
 * when Google's formatted locality (e.g. Rincón de Milberg) is not a zone alias.
 */
export function matchStreetCoverage(
  zones: CoverageZone[],
  args: {
    lat?: number | null;
    lng?: number | null;
    neighborhood?: string | null;
    formatted_address?: string | null;
    address?: string | null;
    coverage_zone_id?: string | null;
    coverage_zone_name?: string | null;
  },
): CoverageMatch {
  const localityCandidates = localityCandidatesFromText(
    args.neighborhood,
    args.coverage_zone_name,
    args.formatted_address,
    args.address,
  );
  const matched = matchZone(zones, {
    lat: args.lat,
    lng: args.lng,
    neighborhood: args.neighborhood,
    localityCandidates,
  });
  if (matched.zone) return matched;
  const lockedId = String(args.coverage_zone_id ?? "").trim();
  if (lockedId) {
    const locked = zones.find((z) => z.id === lockedId) ?? null;
    if (locked) return { zone: locked, match_type: "alias", distance_km: null };
  }
  const lockedName = fold(String(args.coverage_zone_name ?? ""));
  if (lockedName) {
    const byName = zones.find((z) => fold(z.name) === lockedName) ?? null;
    if (byName) return { zone: byName, match_type: "alias", distance_km: null };
  }
  return matched;
}

export function formatCoverageCopy(zoneNames: string[]): string {
  const names = [...new Set(zoneNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) {
    return "Por ahora no hay zonas de cobertura activas. Escribinos por WhatsApp y te ayudamos.";
  }
  if (names.length === 1) return `Por ahora Washero trabaja en ${names[0]}.`;
  if (names.length === 2) return `Por ahora Washero trabaja en ${names[0]} y ${names[1]}.`;
  const head = names.slice(0, -1).join(", ");
  const last = names[names.length - 1]!;
  return `Por ahora Washero trabaja en ${head} y ${last}.`;
}
