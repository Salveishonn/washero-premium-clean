import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadGoogleMapsApi = vi.fn();
const hasPlacesLibrary = vi.fn();

vi.mock("@/lib/google-maps-loader", () => ({
  GOOGLE_MAPS_PUBLIC_KEY: "test-key",
  GOOGLE_MAPS_PUBLIC_KEY_ENV: "VITE_GOOGLE_MAPS_PUBLIC_KEY",
  MAPS_LOAD_ERROR_MESSAGES: {
    no_key: "Falta configurar Google Maps (VITE_GOOGLE_MAPS_PUBLIC_KEY).",
    script_failed: "No pudimos cargar Google Maps.",
    timeout: "timeout",
    maps_missing: "maps_missing",
    places_missing: "places_missing",
  },
  hasPlacesLibrary: (...args: unknown[]) => hasPlacesLibrary(...args),
  loadGoogleMapsApi: (...args: unknown[]) => loadGoogleMapsApi(...args),
  parseMapsLoadFailure: (err: unknown) =>
    err instanceof Error ? err.message : "script_failed",
}));

import { PlacesAutocomplete } from "./PlacesAutocomplete";

function installPlacesMock() {
  const fetchAutocompleteSuggestions = vi.fn(async () => ({
    suggestions: [
      {
        placePrediction: {
          placeId: "place-msavio",
          mainText: { text: "Aconcagua 27" },
          secondaryText: { text: "Maquinista Savio" },
          text: { text: "Aconcagua 27, Maquinista Savio" },
          toPlace: () => ({
            fetchFields: vi.fn(async () => undefined),
            id: "place-msavio",
            formattedAddress: "Aconcagua 27, Maquinista Savio, Buenos Aires",
            location: { lat: () => -34.4, lng: () => -58.7 },
            addressComponents: [
              { longText: "Maquinista Savio", types: ["locality", "political"] },
            ],
          }),
        },
      },
    ],
  }));

  window.google = {
    maps: {
      places: {
        AutocompleteSuggestion: { fetchAutocompleteSuggestions },
        AutocompleteSessionToken: class {},
      },
    },
  };
  hasPlacesLibrary.mockReturnValue(true);
  loadGoogleMapsApi.mockResolvedValue(undefined);
  return fetchAutocompleteSuggestions;
}

function Harness({
  onSelect,
}: {
  onSelect: (place: { place_id: string } | null) => void;
}) {
  const [value, setValue] = useState("");
  return <PlacesAutocomplete value={value} onChange={setValue} onSelect={onSelect} />;
}

describe("PlacesAutocomplete", () => {
  beforeEach(() => {
    loadGoogleMapsApi.mockReset();
    hasPlacesLibrary.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google;
  });

  afterEach(() => {
    document.querySelectorAll(".washero-places-dropdown").forEach((el) => el.remove());
  });

  it("loads the Places library and lets the user pick a suggestion", async () => {
    const fetchSuggestions = installPlacesMock();
    const onSelect = vi.fn();

    render(<Harness onSelect={onSelect} />);

    await waitFor(() => {
      expect(loadGoogleMapsApi).toHaveBeenCalledWith({ requirePlaces: true });
    });
    expect(await screen.findByText(/Empezá a escribir/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Aconcagua 27" } });

    const option = await screen.findByRole("option", { name: /Aconcagua 27/i });
    expect(fetchSuggestions).toHaveBeenCalled();
    fireEvent.click(option);

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          place_id: "place-msavio",
          neighborhood: "Maquinista Savio",
          lat: -34.4,
          lng: -58.7,
        }),
      );
    });
    expect(screen.getByText(/Dirección seleccionada/i)).toBeInTheDocument();
  });

  it("shows an error when the Places library cannot load", async () => {
    loadGoogleMapsApi.mockRejectedValue(new Error("places_missing"));
    hasPlacesLibrary.mockReturnValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      render(<PlacesAutocomplete value="" onChange={() => undefined} onSelect={() => undefined} />);
    });

    expect(await screen.findByText(/places_missing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
