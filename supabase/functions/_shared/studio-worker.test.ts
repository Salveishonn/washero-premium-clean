// Run with: deno test supabase/functions/_shared/studio-worker.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BadRequest, jobTypes, leaseSeconds, mediaPath, newStationToken, parseListedAssets, qcStatus, sha256Hex,
} from "./studio-worker.ts";

const P = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";

Deno.test("sha256Hex matches the known digest", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("station tokens are long, url-safe and unique", () => {
  const a = newStationToken(), b = newStationToken();
  assert(a.startsWith("wst_") && a.length >= 46);
  assert(/^wst_[A-Za-z0-9_-]+$/.test(a));
  assert(a !== b);
});

Deno.test("jobTypes defaults to all and rejects unknown-only lists", () => {
  assertEquals(jobTypes(undefined), ["list_drive", "build", "revise"]);
  assertEquals(jobTypes(["build", "nope"]), ["build"]);
  assertThrows(() => jobTypes(["nope"]), BadRequest);
});

Deno.test("leaseSeconds clamps to 30..900", () => {
  assertEquals(leaseSeconds(5), 30);
  assertEquals(leaseSeconds(5000), 900);
  assertEquals(leaseSeconds("x"), 120);
});

Deno.test("mediaPath is deterministic and refuses traversal", () => {
  assertEquals(mediaPath(P, E, "preview"), `projects/${P}/${E}/preview.mp4`);
  assertEquals(mediaPath(P, E, "contact"), `projects/${P}/${E}/contact.jpg`);
  assertThrows(() => mediaPath("../x", E, "preview"), BadRequest);
  assertThrows(() => mediaPath(P, E, "../../etc"), BadRequest);
});

Deno.test("parseListedAssets classifies files and rejects bad input", () => {
  const out = parseListedAssets([
    { source_id: "1AbCdEfGhIjK", filename: "IMG_3919.MOV", size_bytes: 123 },
    { source_id: "1AbCdEfGhIjL", filename: "track.mp3", size_bytes: null },
    { source_id: "1AbCdEfGhIjM", filename: "photo.HEIC" },
  ]);
  assertEquals(out.map((a) => a.kind), ["video", "audio", "other"]);
  assertThrows(() => parseListedAssets([]), BadRequest);
  assertThrows(() => parseListedAssets([{ source_id: "short", filename: "a.mov" }]), BadRequest);
  assertThrows(() => parseListedAssets([{ source_id: "1AbCdEfGhIjK", filename: "../a.mov" }]), BadRequest);
  assertThrows(() => parseListedAssets([{ source_id: "1AbCdEfGhIjK", filename: "a.mov", size_bytes: -1 }]), BadRequest);
});

Deno.test("qcStatus only accepts pass/warn/fail", () => {
  assertEquals(qcStatus("warn"), "warn");
  assertThrows(() => qcStatus("ok"), BadRequest);
});
