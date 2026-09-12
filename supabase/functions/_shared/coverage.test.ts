// Run with: deno test supabase/functions/_shared/coverage.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractLocalityCandidates,
  fold,
  formatCoverageCopy,
  matchStreetCoverage,
  matchZone,
  type CoverageZone,
} from "./coverage.ts";

function zone(partial: Partial<CoverageZone> & { name: string }): CoverageZone {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    aliases: partial.aliases ?? [],
    center_lat: partial.center_lat ?? null,
    center_lng: partial.center_lng ?? null,
    radius_km: partial.radius_km ?? 5,
    polygon_geojson: partial.polygon_geojson ?? null,
    display_order: partial.display_order ?? 0,
    active: partial.active ?? true,
  };
}

const activeZones = [
  zone({ name: "Maquinista Savio", display_order: 8 }),
  zone({ name: "Garín", aliases: ["Garin"], display_order: 4 }),
  zone({ name: "Benavídez", aliases: ["Benavidez"], display_order: 3 }),
  zone({ name: "Dique Luján", aliases: ["Dique Lujan"], display_order: 5 }),
  zone({ name: "Escobar", display_order: 2 }),
];

Deno.test("normalize folds accents, case, punctuation and whitespace", () => {
  assertEquals(fold("  Garín  "), "garin");
  assertEquals(fold("Benavídez"), "benavidez");
  assertEquals(fold("Dique  Luján"), "dique lujan");
  assertEquals(fold("Maquinista, Savio"), "maquinista savio");
  assertEquals(fold("Garin"), fold("Garín"));
});

Deno.test(
  "active Maquinista Savio matches Google locality candidates from formatted address context",
  () => {
    const candidates = extractLocalityCandidates(
      [
        { long_name: "Aconcagua", types: ["route"] },
        { long_name: "Maquinista Savio", types: ["locality", "political"] },
        { long_name: "Buenos Aires", types: ["administrative_area_level_1", "political"] },
        { long_name: "Argentina", types: ["country", "political"] },
      ],
      ["Maquinista Savio"],
    );
    const match = matchZone(activeZones, {
      localityCandidates: candidates,
      neighborhood: "Maquinista Savio",
    });
    assertEquals(match.match_type, "alias");
    assertEquals(match.zone?.name, "Maquinista Savio");
  },
);

Deno.test("accent normalization matches Garín/Benavídez/Dique Luján", () => {
  assertEquals(matchZone(activeZones, { localityCandidates: ["Garin"] }).zone?.name, "Garín");
  assertEquals(
    matchZone(activeZones, { localityCandidates: ["Benavidez"] }).zone?.name,
    "Benavídez",
  );
  assertEquals(
    matchZone(activeZones, { localityCandidates: ["Dique Lujan"] }).zone?.name,
    "Dique Luján",
  );
});

Deno.test("case and whitespace differences still match", () => {
  assertEquals(
    matchZone(activeZones, { localityCandidates: ["  maquinista   SAVIO "] }).zone?.name,
    "Maquinista Savio",
  );
});

Deno.test("inactive zone is not accepted", () => {
  const zones = [
    zone({ name: "Maquinista Savio", active: false }),
    ...activeZones.filter((z) => z.name !== "Maquinista Savio"),
  ];
  // loadActiveZones filters active=true; simulate that by only passing active rows.
  const match = matchZone(
    zones.filter((z) => z.active),
    { localityCandidates: ["Maquinista Savio"] },
  );
  assertEquals(match.zone, null);
  assertEquals(match.match_type, "none");
});

Deno.test("unrelated locality is rejected", () => {
  const match = matchZone(activeZones, { localityCandidates: ["Pilar"] });
  assertEquals(match.zone, null);
});

Deno.test("match can come from locality, sublocality_level_1, or neighborhood", () => {
  assertEquals(
    matchZone(activeZones, {
      localityCandidates: extractLocalityCandidates([
        { long_name: "Maquinista Savio", types: ["locality"] },
      ]),
    }).zone?.name,
    "Maquinista Savio",
  );
  assertEquals(
    matchZone(activeZones, {
      localityCandidates: extractLocalityCandidates([
        { long_name: "Garín", types: ["sublocality_level_1"] },
      ]),
    }).zone?.name,
    "Garín",
  );
  assertEquals(
    matchZone(activeZones, {
      localityCandidates: extractLocalityCandidates([
        { long_name: "Benavídez", types: ["neighborhood"] },
      ]),
    }).zone?.name,
    "Benavídez",
  );
});

Deno.test("broad administrative area does not accidentally match", () => {
  const match = matchZone(activeZones, {
    localityCandidates: extractLocalityCandidates([
      {
        long_name: "Provincia de Buenos Aires",
        types: ["administrative_area_level_1", "political"],
      },
      { long_name: "Buenos Aires", types: ["administrative_area_level_1", "political"] },
    ]),
    neighborhood: "Provincia de Buenos Aires",
  });
  assertEquals(match.zone, null);
  assertEquals(match.match_type, "none");
});

Deno.test("dynamic coverage copy includes active zones and handles counts", () => {
  assertEquals(
    formatCoverageCopy([]),
    "Por ahora no hay zonas de cobertura activas. Escribinos por WhatsApp y te ayudamos.",
  );
  assertEquals(formatCoverageCopy(["Escobar"]), "Por ahora Washero trabaja en Escobar.");
  assertEquals(
    formatCoverageCopy(["Escobar", "Garín"]),
    "Por ahora Washero trabaja en Escobar y Garín.",
  );
  const many = formatCoverageCopy([
    "Benavídez",
    "Dique Luján",
    "Escobar",
    "Garín",
    "Maquinista Savio",
  ]);
  assertEquals(
    many,
    "Por ahora Washero trabaja en Benavídez, Dique Luján, Escobar, Garín y Maquinista Savio.",
  );
  assertEquals(many.includes("Maquinista Savio"), true);
  assertEquals(many.includes("Pilar"), false);
});

Deno.test("matchStreetCoverage uses a locked zone when locality is not an alias", () => {
  const tigre = zone({
    id: "zone-tigre",
    name: "Tigre",
    aliases: ["Tigre"],
  });
  const match = matchStreetCoverage([tigre], {
    neighborhood: "Rincón de Milberg",
    formatted_address: "Av. de los Lagos 1602, Rincón de Milberg, Provincia de Buenos Aires",
    lat: -34.4,
    lng: -58.64,
    coverage_zone_id: "zone-tigre",
    coverage_zone_name: "Tigre",
  });
  assertEquals(match.zone?.id, "zone-tigre");
  assertEquals(match.match_type, "alias");
});

Deno.test("matchStreetCoverage does not invent coverage without lock or alias", () => {
  const tigre = zone({
    id: "zone-tigre",
    name: "Tigre",
    aliases: ["Tigre"],
  });
  const match = matchStreetCoverage([tigre], {
    neighborhood: "Monserrat",
    formatted_address: "Florida 100, CABA",
  });
  assertEquals(match.zone, null);
  assertEquals(match.match_type, "none");
});

Deno.test("matchStreetCoverage alias-matches Tigre from formatted address parts", () => {
  const tigre = zone({
    id: "zone-tigre",
    name: "Tigre",
    aliases: ["Tigre"],
  });
  const match = matchStreetCoverage([tigre], {
    neighborhood: "Rincón de Milberg",
    formatted_address: "Av. de los Lagos 1602, Tigre, Provincia de Buenos Aires",
  });
  assertEquals(match.zone?.name, "Tigre");
});
