import { describe, expect, it } from "vitest";
import {
  WHATSAPP_CLOUD_ACCESS_TOKEN_ENV,
  WHATSAPP_GRAPH_BASE,
  downloadWhatsAppCloudMedia,
} from "../../supabase/functions/_shared/whatsapp-cloud-media";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(bytes: Uint8Array, contentType: string, status = 200): Response {
  return new Response(bytes, { status, headers: { "content-type": contentType } });
}

describe("downloadWhatsAppCloudMedia", () => {
  it("uses the existing Graph token env name", () => {
    expect(WHATSAPP_CLOUD_ACCESS_TOKEN_ENV).toBe("WHATSAPP_CLOUD_ACCESS_TOKEN");
  });

  it("downloads a valid jpeg via Graph metadata then binary", async () => {
    const calls: string[] = [];
    const result = await downloadWhatsAppCloudMedia("MEDIA_JPEG", {
      token: "test-token",
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith(WHATSAPP_GRAPH_BASE)) {
          return jsonResponse({ url: "https://graph.example/bin", mime_type: "image/jpeg" });
        }
        return bytesResponse(JPEG, "image/jpeg");
      },
    });
    expect(result).toEqual({ ok: true, bytes: JPEG, contentType: "image/jpeg" });
    expect(calls[0]).toContain("/MEDIA_JPEG");
    expect(calls[1]).toBe("https://graph.example/bin");
  });

  it("downloads a valid PDF", async () => {
    const result = await downloadWhatsAppCloudMedia("MEDIA_PDF", {
      token: "test-token",
      fetchImpl: async (input) => {
        if (String(input).startsWith(WHATSAPP_GRAPH_BASE)) {
          return jsonResponse({ url: "https://graph.example/pdf", mime_type: "application/pdf" });
        }
        return bytesResponse(PDF, "application/pdf");
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentType).toBe("application/pdf");
  });

  it("fails closed when media_id is missing", async () => {
    const result = await downloadWhatsAppCloudMedia("  ", {
      token: "test-token",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(result).toEqual({ ok: false, error: "missing_media_id" });
  });

  it("fails closed when the Graph token is missing", async () => {
    const result = await downloadWhatsAppCloudMedia("MEDIA1", {
      token: "",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(result).toEqual({ ok: false, error: "missing_token" });
  });

  it("maps Graph metadata failure", async () => {
    const result = await downloadWhatsAppCloudMedia("MEDIA1", {
      token: "test-token",
      fetchImpl: async () => jsonResponse({ error: "not found" }, 404),
    });
    expect(result).toEqual({ ok: false, error: "graph_meta_failed" });
  });

  it("maps binary download failure", async () => {
    const result = await downloadWhatsAppCloudMedia("MEDIA1", {
      token: "test-token",
      fetchImpl: async (input) => {
        if (String(input).startsWith(WHATSAPP_GRAPH_BASE)) {
          return jsonResponse({ url: "https://graph.example/bin" });
        }
        return new Response("nope", { status: 500 });
      },
    });
    expect(result).toEqual({ ok: false, error: "graph_binary_failed" });
  });

  it("rejects oversize content-length before buffering a huge body", async () => {
    const result = await downloadWhatsAppCloudMedia("MEDIA1", {
      token: "test-token",
      maxBytes: 100,
      fetchImpl: async (input) => {
        if (String(input).startsWith(WHATSAPP_GRAPH_BASE)) {
          return jsonResponse({ url: "https://graph.example/bin" });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "101", "content-type": "image/jpeg" },
        });
      },
    });
    expect(result).toEqual({ ok: false, error: "oversize" });
  });
});
