import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  GOOGLE_MAPS_PUBLIC_KEY,
  GOOGLE_MAPS_PUBLIC_KEY_ENV,
  MAPS_LOAD_ERROR_MESSAGES,
  hasPlacesLibrary,
  loadGoogleMapsApi,
  parseMapsLoadFailure,
  type MapsLoadFailure,
} from "@/lib/google-maps-loader";
import {
  PLACES_DROPDOWN_CLASS,
  placeSelectionFromGooglePlace,
  suggestionLabel,
  type PlaceSelection,
} from "@/lib/places-selection";

export type { PlaceSelection };

const SUGGEST_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
/** Bias results to Zona Norte / GBA where Washero operates. */
const LOCATION_BIAS = { radius: 40_000, center: { lat: -34.48, lng: -58.55 } };

type SuggestionRow = {
  placeId: string;
  main: string;
  secondary: string;
  full: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prediction: any;
};

export function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (p: PlaceSelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionTokenRef = useRef<any>(null);
  const requestIdRef = useRef(0);
  const listId = useId();

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "selected" | "error">(
    GOOGLE_MAPS_PUBLIC_KEY ? "loading" : "error",
  );
  const [errorKind, setErrorKind] = useState<MapsLoadFailure | null>(
    GOOGLE_MAPS_PUBLIC_KEY ? null : "no_key",
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selecting, setSelecting] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!GOOGLE_MAPS_PUBLIC_KEY) {
      console.error(`[PlacesAutocomplete] Missing ${GOOGLE_MAPS_PUBLIC_KEY_ENV}`);
      setErrorKind("no_key");
      setStatus("error");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setErrorKind(null);

    const fail = (kind: MapsLoadFailure) => {
      if (cancelled) return;
      setErrorKind(kind);
      setStatus("error");
    };

    loadGoogleMapsApi({ requirePlaces: true })
      .then(() => {
        if (cancelled) return;
        if (!hasPlacesLibrary() || !window.google?.maps?.places?.AutocompleteSuggestion) {
          console.error("[PlacesAutocomplete] Places AutocompleteSuggestion missing after load");
          fail("places_missing");
          return;
        }
        placesRef.current = window.google.maps.places;
        sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        const kind = parseMapsLoadFailure(err);
        console.error(`[PlacesAutocomplete] Google Maps load failed: ${kind}`, err);
        fail(kind);
      });

    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  useEffect(() => {
    if (status !== "ready" && status !== "selected") return;
    const query = value.trim();
    if (status === "selected" || query.length < MIN_QUERY_LENGTH || disabled) {
      requestIdRef.current += 1;
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    const places = placesRef.current;
    if (!places?.AutocompleteSuggestion) return;

    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!sessionTokenRef.current) {
            sessionTokenRef.current = new places.AutocompleteSessionToken();
          }
          const { suggestions: raw } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
            {
              input: query,
              includedRegionCodes: ["ar"],
              language: "es",
              region: "ar",
              sessionToken: sessionTokenRef.current,
              locationBias: LOCATION_BIAS,
            },
          );
          if (requestId !== requestIdRef.current) return;
          const rows: SuggestionRow[] = (raw ?? [])
            .map((item: { placePrediction?: unknown }) => {
              const prediction = item?.placePrediction;
              if (!prediction || typeof prediction !== "object") return null;
              const pred = prediction as {
                placeId?: string;
                toPlace?: () => unknown;
                text?: { text?: string };
                mainText?: { text?: string };
                secondaryText?: { text?: string };
              };
              const placeId = String(pred.placeId ?? "").trim();
              if (!placeId) return null;
              const label = suggestionLabel(pred);
              return { placeId, ...label, prediction: pred };
            })
            .filter((row: SuggestionRow | null): row is SuggestionRow => row !== null);
          setSuggestions(rows);
          setOpen(rows.length > 0);
          setActiveIndex(rows.length > 0 ? 0 : -1);
        } catch (err) {
          if (requestId !== requestIdRef.current) return;
          console.error("[PlacesAutocomplete] AutocompleteSuggestion failed", err);
          setSuggestions([]);
          setOpen(false);
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, status, disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;

    const update = () => {
      const rect = input.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 999999,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, suggestions.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const pickSuggestion = async (row: SuggestionRow) => {
    if (selecting) return;
    setSelecting(true);
    try {
      const place = row.prediction?.toPlace?.();
      if (!place || typeof place.fetchFields !== "function") {
        throw new Error("places_missing");
      }
      await place.fetchFields({
        fields: ["id", "formattedAddress", "location", "addressComponents"],
      });
      const selection = placeSelectionFromGooglePlace(place);
      if (!selection) {
        onSelect(null);
        setStatus("ready");
        return;
      }
      const places = placesRef.current;
      if (places?.AutocompleteSessionToken) {
        sessionTokenRef.current = new places.AutocompleteSessionToken();
      }
      onChange(selection.formatted_address || row.full);
      onSelect(selection);
      setStatus("selected");
      setSuggestions([]);
      setOpen(false);
    } catch (err) {
      console.error("[PlacesAutocomplete] place details failed", err);
      onSelect(null);
      setStatus("ready");
    } finally {
      setSelecting(false);
    }
  };

  const errorMessage = errorKind
    ? MAPS_LOAD_ERROR_MESSAGES[errorKind]
    : MAPS_LOAD_ERROR_MESSAGES.script_failed;

  return (
    <div ref={rootRef} className="space-y-1.5">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="pl-9"
          placeholder={placeholder ?? "Buscá tu dirección"}
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
          onChange={(e) => {
            onChange(e.target.value);
            if (status === "selected") setStatus("ready");
            onSelect(null);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open || suggestions.length === 0) {
              if (e.key === "Escape") setOpen(false);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (e.key === "Enter") {
              const row = suggestions[activeIndex] ?? suggestions[0];
              if (row) {
                e.preventDefault();
                void pickSuggestion(row);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          disabled={disabled || selecting}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      {open && suggestions.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              role="listbox"
              style={menuStyle}
              className={cn(
                PLACES_DROPDOWN_CLASS,
                "pac-container max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
              )}
            >
              {suggestions.map((row, index) => (
                <li
                  key={row.placeId}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pickSuggestion(row)}
                >
                  <div className="font-medium leading-tight">{row.main}</div>
                  {row.secondary ? (
                    <div className="text-xs text-muted-foreground leading-tight">{row.secondary}</div>
                  ) : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
      <div
        className={cn(
          "flex items-center gap-1 text-xs",
          status === "selected" && "text-emerald-600",
          status === "error" && "text-destructive",
          (status === "loading" || status === "ready" || status === "idle") &&
            "text-muted-foreground",
        )}
      >
        {status === "loading" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando buscador de direcciones…
          </>
        )}
        {status === "ready" && <>Empezá a escribir y elegí una sugerencia.</>}
        {status === "selected" && (
          <>
            <CheckCircle2 className="h-3 w-3" /> Dirección seleccionada.
          </>
        )}
        {status === "error" && (
          <>
            <AlertCircle className="h-3 w-3" /> {errorMessage}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              Reintentar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
