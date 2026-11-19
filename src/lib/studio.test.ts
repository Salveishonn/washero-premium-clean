import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  DEFAULT_VO_LINES,
  MUSIC_PRESETS,
  buildControls,
  canApprove,
  changeFormDefaults,
  stripVoiceTags,
  captionText,
  formatBytes,
  isDriveFolderUrl,
  latestRenderByEdit,
  stationOnline,
  totalBytes,
  type StudioRender,
} from "./studio";

describe("studio helpers", () => {
  const now = Date.parse("2026-11-18T20:00:00Z");

  it("stationOnline: active and seen in the last 3 minutes", () => {
    expect(stationOnline({ status: "active", last_seen_at: "2026-11-18T19:58:30Z" }, now)).toBe(
      true,
    );
    expect(stationOnline({ status: "active", last_seen_at: "2026-11-18T19:50:00Z" }, now)).toBe(
      false,
    );
    expect(stationOnline({ status: "revoked", last_seen_at: "2026-11-18T19:59:59Z" }, now)).toBe(
      false,
    );
    expect(stationOnline({ status: "active", last_seen_at: null }, now)).toBe(false);
  });

  it("formatBytes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(7_902_000_000)).toBe("7.90 GB");
    expect(formatBytes(42_200_000)).toBe("42.2 MB");
    expect(formatBytes(900)).toBe("900 B");
  });

  it("isDriveFolderUrl accepts folder links only", () => {
    expect(
      isDriveFolderUrl(
        "https://drive.google.com/drive/folders/1xe59oYM8bAg2RapwXRTw1_QFlVXGsxIi?usp=sharing",
      ),
    ).toBe(true);
    expect(
      isDriveFolderUrl(
        "https://drive.google.com/drive/u/1/folders/1xe59oYM8bAg2RapwXRTw1_QFlVXGsxIi",
      ),
    ).toBe(true);
    expect(isDriveFolderUrl("https://drive.google.com/file/d/1xe59oYM8bAg2Rap/view")).toBe(false);
    expect(isDriveFolderUrl("https://example.com/drive/folders/abcdefghijk")).toBe(false);
  });

  it("canApprove blocks failed QC and missing renders", () => {
    expect(canApprove(null)).toBe(false);
    expect(canApprove({ status: "ready", qc_status: "fail" })).toBe(false);
    expect(canApprove({ status: "ready", qc_status: "warn" })).toBe(true);
    expect(canApprove({ status: "failed", qc_status: "pass" })).toBe(false);
  });

  it("latestRenderByEdit keeps the newest render per edit", () => {
    const r = (id: string, edit: string, at: string) =>
      ({ id, edit_id: edit, created_at: at }) as StudioRender;
    const m = latestRenderByEdit([
      r("a", "e1", "2026-11-18T10:00:00Z"),
      r("b", "e1", "2026-11-18T11:00:00Z"),
      r("c", "e2", "2026-11-18T09:00:00Z"),
    ]);
    expect(m.get("e1")?.id).toBe("b");
    expect(m.get("e2")?.id).toBe("c");
  });

  it("captionText joins text and hashtags", () => {
    expect(captionText({ edl: { caption: { text: "Hola", hashtags: ["#a", "#b"] } } })).toBe(
      "Hola\n\n#a #b",
    );
    expect(captionText({ edl: {} })).toBe("");
    expect(
      captionText({
        edl: { caption: { text: "Hola #WASHERO #Lavado", hashtags: ["#washero", "#Nuevo"] } },
      }),
    ).toBe("Hola #WASHERO #Lavado\n\n#Nuevo");
  });

  it("totalBytes ignores unknown sizes", () => {
    expect(totalBytes([{ size_bytes: 10 }, { size_bytes: null }, { size_bytes: 5 }])).toBe(15);
  });

  describe("change requests", () => {
    const plan = {
      structure: [
        { act: "open", seconds: 3 },
        { act: "build", seconds: 5 },
        { act: "peak", seconds: 4 },
        { act: "resolve", seconds: 3 },
      ],
      audio: { strategy: "natural" },
      branding: { strategy: "minimal_end_logo" },
      caption: "Hola",
    };
    const edit = { plan, edl: { output: { duration_s: 15 } } };

    it("defaults come from the base version", () => {
      const d = changeFormDefaults(edit, { duration_s: 16.4 });
      expect(d).toMatchObject({
        duration_s: 16,
        end_hold_s: 1.8,
        vo_enabled: false,
        music_enabled: false,
        music_prompt: MUSIC_PRESETS[0].prompt,
        plate_style: "logo",
        caption: "Hola",
      });
      expect(d.vo_text.split("\n")).toEqual(DEFAULT_VO_LINES.map(stripVoiceTags));
    });

    it("unchanged form sends nothing", () => {
      const d = changeFormDefaults(edit);
      expect(buildControls(d, { ...d }, plan)).toEqual({});
    });

    it("sends only what changed and keeps tags on untouched script lines", () => {
      const d = changeFormDefaults(edit);
      const rows = d.vo_text.split("\n");
      rows[2] = "Todo a mano.";
      const c = buildControls(
        d,
        {
          ...d,
          duration_s: 20,
          end_hold_s: 3,
          vo_enabled: true,
          vo_text: rows.join("\n") + "\n\n",
          music_enabled: true,
          plate_style: "blur",
          caption: " Hola ",
        },
        plan,
      );
      expect(c).toEqual({
        duration_s: 20,
        end_hold_s: 3,
        voiceover: {
          enabled: true,
          lines: [DEFAULT_VO_LINES[0], DEFAULT_VO_LINES[1], "Todo a mano.", DEFAULT_VO_LINES[3]],
        },
        music: { enabled: true, prompt: MUSIC_PRESETS[0].prompt },
        plate_style: "blur",
      });
    });

    it("turning voice and music off", () => {
      const on = {
        ...plan,
        audio: { strategy: "music", music_prompt: "x" },
        voiceover: { lines: [{ text: "[cálido] Hola" }] },
      };
      const d = changeFormDefaults({ plan: on, edl: {} });
      expect(d.vo_text).toBe("Hola");
      expect(buildControls(d, { ...d, vo_enabled: false, music_enabled: false }, on)).toEqual({
        voiceover: { enabled: false },
        music: { enabled: false },
      });
    });
  });
});
