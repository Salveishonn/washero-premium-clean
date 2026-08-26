import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_MAPS_PUBLIC_KEY,
  GOOGLE_MAPS_PUBLIC_KEY_ENV,
  GOOGLE_MAPS_PUBLIC_KEY_SOURCE,
  MAPS_LOAD_ERROR_MESSAGES,
  loadGoogleMapsApi,
  parseMapsLoadFailure,
} from "./google-maps-loader";

describe("google-maps-loader key resolution", () => {
  it("exposes the canonical env var name", () => {
    expect(GOOGLE_MAPS_PUBLIC_KEY_ENV).toBe("VITE_GOOGLE_MAPS_PUBLIC_KEY");
  });

  it("resolves a non-empty Maps browser key in test/dev builds", () => {
    expect(typeof GOOGLE_MAPS_PUBLIC_KEY).toBe("string");
    expect(GOOGLE_MAPS_PUBLIC_KEY?.length).toBeGreaterThan(10);
    expect(GOOGLE_MAPS_PUBLIC_KEY_SOURCE === "missing").toBe(false);
  });

  it("keeps no_key copy actionable for operators", () => {
    expect(MAPS_LOAD_ERROR_MESSAGES.no_key).toContain(GOOGLE_MAPS_PUBLIC_KEY_ENV);
  });

  it("parses known load failure codes", () => {
    expect(parseMapsLoadFailure(new Error("no_key"))).toBe("no_key");
    expect(parseMapsLoadFailure(new Error("places_missing"))).toBe("places_missing");
    expect(parseMapsLoadFailure(new Error("boom"))).toBe("script_failed");
  });

  it("mentions Places API (New) in the places_missing copy", () => {
    expect(MAPS_LOAD_ERROR_MESSAGES.places_missing).toMatch(/Places API \(New\)/i);
  });
});

describe("loadGoogleMapsApi bootstrap", () => {
  afterEach(() => {
    window.__washeroMapsCoreLoading = undefined;
    window.__washeroMapsReady = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google;
    document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]').forEach((el) => {
      el.remove();
    });
  });

  it("injects Maps JS with loading=async and then importLibrary(places)", async () => {
    const pending = loadGoogleMapsApi({ requirePlaces: true });
    const script = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]',
    );
    expect(script).toBeTruthy();
    expect(script?.src).toContain("loading=async");
    expect(script?.src).toContain("callback=__washeroMapsReady");
    expect(script?.src).not.toContain("libraries=places");

    const importLibrary = vi.fn(async (name: string) => {
      if (name === "maps") {
        window.google.maps.Map = function Map() {};
      }
      if (name === "places") {
        window.google.maps.places = {
          AutocompleteSuggestion: function AutocompleteSuggestion() {},
        };
      }
      return {};
    });
    window.google = { maps: { importLibrary } };
    window.__washeroMapsReady?.();

    await pending;
    expect(importLibrary).toHaveBeenCalledWith("maps");
    expect(importLibrary).toHaveBeenCalledWith("places");
  });
});
