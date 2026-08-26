import { extractLocalityCandidates, type CoverageAddressComponent } from "@/lib/coverage-zones";

/** Class used by the custom Places dropdown (and Dialog outside-click guards). */
export const PLACES_DROPDOWN_CLASS = "washero-places-dropdown";

export type PlaceSelection = {
  place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
  locality_candidates: string[];
  address_components: CoverageAddressComponent[];
};

export type GoogleAddressComponentLike = {
  longText?: string | null;
  shortText?: string | null;
  long_name?: string | null;
  short_name?: string | null;
  types?: string[] | null;
};

export type GooglePlaceLike = {
  id?: string | null;
  place_id?: string | null;
  formattedAddress?: string | null;
  formatted_address?: string | null;
  location?: unknown;
  addressComponents?: GoogleAddressComponentLike[] | null;
  address_components?: GoogleAddressComponentLike[] | null;
};

export function coverageComponentsFromGoogle(
  components: GoogleAddressComponentLike[] | null | undefined,
): CoverageAddressComponent[] {
  return (components ?? []).map((component) => ({
    long_name: component.longText ?? component.long_name ?? undefined,
    short_name: component.shortText ?? component.short_name ?? undefined,
    types: Array.isArray(component.types) ? component.types : undefined,
  }));
}

export function readLatLng(location: unknown): { lat: number; lng: number } | null {
  if (!location || typeof location !== "object") return null;
  const loc = location as { lat?: unknown; lng?: unknown };
  const lat = typeof loc.lat === "function" ? (loc.lat as () => unknown)() : loc.lat;
  const lng = typeof loc.lng === "function" ? (loc.lng as () => unknown)() : loc.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return { lat, lng };
}

export function placeSelectionFromGooglePlace(place: GooglePlaceLike): PlaceSelection | null {
  const place_id = String(place.id ?? place.place_id ?? "").trim();
  const coords = readLatLng(place.location);
  if (!place_id || !coords) return null;

  const comps = coverageComponentsFromGoogle(place.addressComponents ?? place.address_components);
  const findType = (type: string) => comps.find((c) => c.types?.includes(type))?.long_name ?? null;
  const neighborhood =
    findType("locality") ||
    findType("sublocality_level_1") ||
    findType("sublocality") ||
    findType("neighborhood") ||
    findType("postal_town") ||
    findType("administrative_area_level_2") ||
    null;

  return {
    place_id,
    formatted_address: String(place.formattedAddress ?? place.formatted_address ?? "").trim(),
    lat: coords.lat,
    lng: coords.lng,
    neighborhood,
    locality_candidates: extractLocalityCandidates(comps, [neighborhood]),
    address_components: comps,
  };
}

export function suggestionLabel(prediction: {
  text?: { text?: string | null } | null;
  mainText?: { text?: string | null } | null;
  secondaryText?: { text?: string | null } | null;
}): { main: string; secondary: string; full: string } {
  const main = String(prediction.mainText?.text ?? "").trim();
  const secondary = String(prediction.secondaryText?.text ?? "").trim();
  const full = String(
    prediction.text?.text ?? [main, secondary].filter(Boolean).join(", "),
  ).trim();
  return { main: main || full, secondary, full };
}
