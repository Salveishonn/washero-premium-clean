import { describe, expect, it } from "vitest";
import { placeSelectionFromGooglePlace, readLatLng, suggestionLabel } from "./places-selection";

describe("readLatLng", () => {
  it("reads LatLng methods and literal objects", () => {
    expect(readLatLng({ lat: () => -34.4, lng: () => -58.7 })).toEqual({ lat: -34.4, lng: -58.7 });
    expect(readLatLng({ lat: -34.4, lng: -58.7 })).toEqual({ lat: -34.4, lng: -58.7 });
    expect(readLatLng(null)).toBeNull();
    expect(readLatLng({ lat: "x", lng: -58.7 })).toBeNull();
  });
});

describe("placeSelectionFromGooglePlace", () => {
  it("maps Places API (New) fields onto the booking PlaceSelection shape", () => {
    const selection = placeSelectionFromGooglePlace({
      id: "place-msavio",
      formattedAddress: "Aconcagua 27, Maquinista Savio",
      location: { lat: () => -34.4, lng: () => -58.7 },
      addressComponents: [
        { longText: "Maquinista Savio", shortText: "M. Savio", types: ["locality", "political"] },
        { longText: "Provincia de Buenos Aires", types: ["administrative_area_level_1", "political"] },
      ],
    });

    expect(selection).toMatchObject({
      place_id: "place-msavio",
      formatted_address: "Aconcagua 27, Maquinista Savio",
      lat: -34.4,
      lng: -58.7,
      neighborhood: "Maquinista Savio",
    });
    expect(selection?.locality_candidates).toContain("Maquinista Savio");
    expect(selection?.address_components[0]).toEqual({
      long_name: "Maquinista Savio",
      short_name: "M. Savio",
      types: ["locality", "political"],
    });
  });

  it("returns null without a place id or coordinates", () => {
    expect(
      placeSelectionFromGooglePlace({
        formattedAddress: "x",
        location: { lat: -34.4, lng: -58.7 },
      }),
    ).toBeNull();
    expect(placeSelectionFromGooglePlace({ id: "abc" })).toBeNull();
  });
});

describe("suggestionLabel", () => {
  it("prefers main/secondary text and falls back to the full prediction text", () => {
    expect(
      suggestionLabel({
        mainText: { text: "Aconcagua 27" },
        secondaryText: { text: "Maquinista Savio" },
        text: { text: "Aconcagua 27, Maquinista Savio" },
      }),
    ).toEqual({
      main: "Aconcagua 27",
      secondary: "Maquinista Savio",
      full: "Aconcagua 27, Maquinista Savio",
    });
  });
});
