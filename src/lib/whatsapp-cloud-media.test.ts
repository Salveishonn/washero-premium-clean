import { describe, expect, it } from "vitest";
import {
  capturePaymentReceipt,
  type PaymentReceiptCapturePorts,
} from "../../supabase/functions/_shared/payment-receipt-capture";
import {
  WASHERO_INBOUND_PHONE_NUMBER_ID,
  WHATSAPP_CLOUD_ACCESS_TOKEN_ENV,
  WHATSAPP_GRAPH_BASE,
  downloadWhatsAppCloudMedia,
  graphMediaMetaUrl,
} from "../../supabase/functions/_shared/whatsapp-cloud-media";
import { WA_CLOUD_PHONE_NUMBER_ID } from "../../supabase/functions/_shared/whatsapp-cloud";

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
    expect(calls[0]).toContain("fields=");
    expect(calls[1]).toBe("https://graph.example/bin");
  });

  it("scopes Graph metadata to the inbound phone_number_id", async () => {
    const calls: string[] = [];
    await downloadWhatsAppCloudMedia("MEDIA_JPEG", {
      token: "test-token",
      phoneNumberId: WASHERO_INBOUND_PHONE_NUMBER_ID,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith(WHATSAPP_GRAPH_BASE)) {
          return jsonResponse({ url: "https://graph.example/bin", mime_type: "image/jpeg" });
        }
        return bytesResponse(JPEG, "image/jpeg");
      },
    });
    expect(calls[0]).toContain(`phone_number_id=${WASHERO_INBOUND_PHONE_NUMBER_ID}`);
    expect(calls[0]).not.toContain(WA_CLOUD_PHONE_NUMBER_ID);
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

describe("Cloud inbound receipt Graph media (production bug)", () => {
  it("does not use the outbound Cloud number for inbound media GET", () => {
    expect(WASHERO_INBOUND_PHONE_NUMBER_ID).toBe("1128142377056954");
    expect(WA_CLOUD_PHONE_NUMBER_ID).toBe("1327924187062435");
    expect(WASHERO_INBOUND_PHONE_NUMBER_ID).not.toBe(WA_CLOUD_PHONE_NUMBER_ID);
    const url = graphMediaMetaUrl("MEDIA_RECEIPT", WASHERO_INBOUND_PHONE_NUMBER_ID);
    expect(url).toContain("/MEDIA_RECEIPT?");
    expect(url).toContain("phone_number_id=1128142377056954");
    expect(url).not.toContain("1327924187062435");
    expect(graphMediaMetaUrl("MEDIA_RECEIPT")).not.toContain("phone_number_id=");
  });

  it("downloads inbound receipt bytes and feeds canonical capture", async () => {
    const graphCalls: string[] = [];
    const downloaded = await downloadWhatsAppCloudMedia("MEDIA_RECEIPT", {
      token: "test-token",
      phoneNumberId: WASHERO_INBOUND_PHONE_NUMBER_ID,
      fetchImpl: async (input) => {
        const url = String(input);
        graphCalls.push(url);
        if (url.startsWith(WHATSAPP_GRAPH_BASE)) {
          expect(url).toContain("phone_number_id=1128142377056954");
          expect(url).not.toContain(WA_CLOUD_PHONE_NUMBER_ID);
          return jsonResponse({ url: "https://lookaside.example/bin", mime_type: "image/jpeg" });
        }
        expect(url).toBe("https://lookaside.example/bin");
        return bytesResponse(JPEG, "image/jpeg");
      },
    });
    expect(downloaded).toEqual({ ok: true, bytes: JPEG, contentType: "image/jpeg" });

    const inserts: unknown[] = [];
    const ports: PaymentReceiptCapturePorts = {
      findDuplicateByExternalMessageId: async () => null,
      findDuplicateByBotmakerMessageId: async () => null,
      matchBooking: async () => ({
        bookingId: "bk-unique",
        receiptStatus: "pending_review",
        eligibleCount: 1,
      }),
      ensureBucket: async () => {},
      uploadObject: async () => ({ error: null }),
      insertReceipt: async (row) => {
        inserts.push(row);
        return { error: null };
      },
      removeExact: async () => ({ error: null }),
      now: () => 1789249125247,
      createId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      logSafe: () => {},
    };
    const result = await capturePaymentReceipt(ports, {
      phone: "5491100000000",
      customerPhoneNormalized: "5491100000000",
      botmakerMessageId: null,
      externalMessageId: "wamid.test.inbound.graph",
      messageType: "image",
      mimeType: "image/jpeg",
      fileName: "comprobante.jpg",
      mediaUrl: "graph://MEDIA_RECEIPT",
      persistZeroMatch: false,
      mediaFailurePolicy: "abort",
      loadMediaBytes: async () => {
        if (!downloaded.ok) return { ok: false, reason: "download_failed" };
        return { ok: true, bytes: downloaded.bytes, contentType: downloaded.contentType };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      outcome: "pending_review",
      captured: true,
      duplicate: false,
      booking_matched: true,
    });
    expect(inserts).toHaveLength(1);
    expect(graphCalls[0]).toContain("phone_number_id=1128142377056954");
  });
});
