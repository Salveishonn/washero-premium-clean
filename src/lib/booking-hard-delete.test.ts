import { describe, expect, it } from "vitest";
import {
  PROOF_LIST_MAX_OBJECTS,
  PROOF_LIST_PAGE_SIZE,
  classifyAdminHardDeleteAuth,
  enumerateBookingProofPaths,
  isIsolatedBookingProofPath,
  isValidProofStoragePath,
  joinListedObjectPath,
  parseDeleteBookingRequest,
  runCanonicalBookingHardDelete,
  type HardDeletePorts,
  type ListedStorageItem,
} from "../../supabase/functions/_shared/booking-hard-delete";

const BOOKING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_BOOKING = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF_A = "11111111-2222-4333-8444-555555555555";
const PROOF_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function proofPath(proofId: string, ext = "png") {
  return `${BOOKING_ID}/${proofId}.${ext}`;
}

type FakeObject = { name: string; id: string | null };

function createFakeStore(initial: string[] = []) {
  const objects = new Set(initial);
  let removeShouldFail = false;
  let bookingExists = true;
  let bookingDeleteShouldFail = false;
  let invoiceDeleteShouldFail = false;
  let proofMediaCount = 0;
  const removed: string[] = [];
  const deletedBooking: string[] = [];

  const store = {
    objects,
    removed,
    deletedBooking,
    setRemoveShouldFail(value: boolean) {
      removeShouldFail = value;
    },
    setBookingExists(value: boolean) {
      bookingExists = value;
    },
    setBookingDeleteShouldFail(value: boolean) {
      bookingDeleteShouldFail = value;
    },
    setInvoiceDeleteShouldFail(value: boolean) {
      invoiceDeleteShouldFail = value;
    },
    setProofMediaCount(value: number) {
      proofMediaCount = value;
    },
    ports: {
      async getBooking() {
        return { exists: bookingExists };
      },
      async listProofPage(folder: string, offset: number, limit: number) {
        const prefix = `${folder}/`;
        const items: FakeObject[] = [...objects]
          .filter((path) => path.startsWith(prefix) || path === folder)
          .map((path) => {
            const rest = path.slice(prefix.length);
            const slash = rest.indexOf("/");
            if (slash >= 0) {
              return { name: rest.slice(0, slash), id: null };
            }
            return { name: rest, id: `id-${rest}` };
          })
          .filter((item, index, all) => all.findIndex((other) => other.name === item.name) === index)
          .sort((a, b) => a.name.localeCompare(b.name));
        return { ok: true as const, items: items.slice(offset, offset + limit) };
      },
      async removeProofObjects(paths: string[]) {
        if (removeShouldFail) return { ok: false as const, error: "boom" };
        for (const path of paths) {
          objects.delete(path);
          removed.push(path);
        }
        return { ok: true as const };
      },
      async deleteInvoices() {
        if (invoiceDeleteShouldFail) return { ok: false as const, error: "invoice" };
        return { ok: true as const };
      },
      async deleteBooking(bookingId: string) {
        if (bookingDeleteShouldFail) return { ok: false as const, error: "booking" };
        bookingExists = false;
        proofMediaCount = 0;
        deletedBooking.push(bookingId);
        return { ok: true as const };
      },
      async countProofMedia() {
        return { ok: true as const, count: proofMediaCount };
      },
    } satisfies HardDeletePorts,
  };

  return store;
}

describe("proof storage path validation", () => {
  it("accepts the canonical booking-id/proof-id.ext path", () => {
    expect(isValidProofStoragePath(BOOKING_ID, proofPath(PROOF_A))).toBe(true);
    expect(isValidProofStoragePath(BOOKING_ID, proofPath(PROOF_A, "jpg"))).toBe(true);
  });

  it("rejects traversal, empty, leading slash, backslash, and cross-booking paths", () => {
    expect(isValidProofStoragePath(BOOKING_ID, "")).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `/${proofPath(PROOF_A)}`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}\\${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}/../${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}/../../something`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${OTHER_BOOKING}/${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `booking-proofs/${BOOKING_ID}/${PROOF_A}.png`)).toBe(false);
    expect(isIsolatedBookingProofPath(BOOKING_ID, `${BOOKING_ID}/%2e%2e/secret.png`)).toBe(false);
  });

  it("does not join listed names that escape the trusted prefix", () => {
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, "..")).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, "../other.png")).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, OTHER_BOOKING, `${PROOF_A}.png`)).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, `${PROOF_A}.png`)).toBe(
      proofPath(PROOF_A),
    );
  });
});

describe("authorization classification", () => {
  it("returns 401 when unauthenticated", () => {
    expect(
      classifyAdminHardDeleteAuth({ authHeader: null, userId: null, staff: null }),
    ).toEqual({ ok: false, code: "unauthorized", httpStatus: 401 });
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: null,
        staff: null,
      }),
    ).toEqual({ ok: false, code: "unauthorized", httpStatus: 401 });
  });

  it("returns 403 for operators and non-admin staff", () => {
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "op-1", role: "operator", active: true },
      }),
    ).toEqual({ ok: false, code: "forbidden", httpStatus: 403 });
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "adm-1", role: "admin", active: false },
      }),
    ).toEqual({ ok: false, code: "forbidden", httpStatus: 403 });
  });

  it("allows active owner and admin", () => {
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "adm-1", role: "admin", active: true },
      }),
    ).toEqual({ ok: true, adminUserId: "adm-1", role: "admin" });
  });
});

describe("request contract", () => {
  it("requires an exact UUID booking_id and ignores client storage paths", () => {
    expect(parseDeleteBookingRequest({ booking_id: BOOKING_ID, storage_path: "evil" })).toEqual({
      ok: true,
      booking_id: BOOKING_ID,
    });
    expect(parseDeleteBookingRequest({ booking_id: "not-a-uuid" }).ok).toBe(false);
    expect(parseDeleteBookingRequest({}).ok).toBe(false);
  });
});

describe("prefix listing pagination", () => {
  it("pages until the folder is exhausted", async () => {
    const names = Array.from({ length: PROOF_LIST_PAGE_SIZE + 2 }, (_, i) => {
      const suffix = String(i).padStart(12, "0");
      return `${BOOKING_ID}/11111111-2222-4333-8444-${suffix}.png`;
    });
    const listed: ListedStorageItem[] = names.map((path, i) => ({
      name: path.slice(BOOKING_ID.length + 1),
      id: `id-${i}`,
    }));
    const offsets: number[] = [];
    const result = await enumerateBookingProofPaths(BOOKING_ID, async (_folder, offset, limit) => {
      offsets.push(offset);
      return { ok: true, items: listed.slice(offset, offset + limit) };
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paths).toHaveLength(PROOF_LIST_PAGE_SIZE + 2);
    expect(offsets).toEqual([0, PROOF_LIST_PAGE_SIZE]);
  });

  it("fails safely when the object cap is exceeded", async () => {
    const listed: ListedStorageItem[] = Array.from({ length: PROOF_LIST_PAGE_SIZE }, (_, i) => ({
      name: `file-${i}.png`,
      id: `id-${i}`,
    }));
    let calls = 0;
    const result = await enumerateBookingProofPaths(BOOKING_ID, async () => {
      calls += 1;
      if (calls > 20) return { ok: true, items: [] };
      return { ok: true, items: listed };
    });
    expect(result).toEqual({ ok: false, error: "too_many_objects" });
  });
});

describe("canonical hard-delete algorithm", () => {
  it("case 1: deletes a booking with zero proof objects", async () => {
    const fake = createFakeStore();
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, booking_id: BOOKING_ID, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 2: removes one proof object then deletes the booking", async () => {
    const path = proofPath(PROOF_A);
    const fake = createFakeStore([path]);
    fake.setProofMediaCount(1);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 1 });
    expect(fake.removed).toEqual([path]);
    expect(fake.objects.size).toBe(0);
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 3: removes multiple proof objects", async () => {
    const paths = [proofPath(PROOF_A), proofPath(PROOF_B, "jpg")];
    const fake = createFakeStore(paths);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 2 });
    expect(fake.removed.sort()).toEqual(paths.sort());
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 4: succeeds when metadata exists but the storage object is already missing", async () => {
    const fake = createFakeStore([]);
    fake.setProofMediaCount(1);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 5: storage failure keeps the booking and metadata", async () => {
    const fake = createFakeStore([proofPath(PROOF_A)]);
    fake.setProofMediaCount(1);
    fake.setRemoveShouldFail(true);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: false, error: "storage_delete_failed", retryable: true });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.objects.has(proofPath(PROOF_A))).toBe(true);
  });

  it("case 6: deletes orphan objects under the exact booking prefix", async () => {
    const orphan = `${BOOKING_ID}/orphan-file.bin`;
    const fake = createFakeStore([orphan]);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 1 });
    expect(fake.removed).toEqual([orphan]);
    expect(fake.objects.size).toBe(0);
  });

  it("does not delete objects under a different booking prefix", async () => {
    const other = `${OTHER_BOOKING}/${PROOF_A}.png`;
    const fake = createFakeStore([other]);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.objects.has(other)).toBe(true);
  });

  it("case 7: DB delete failure after storage cleanup is retryable", async () => {
    const path = proofPath(PROOF_A);
    const fake = createFakeStore([path]);
    fake.setBookingDeleteShouldFail(true);
    const first = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(first).toMatchObject({ ok: false, error: "booking_delete_failed", retryable: true });
    expect(fake.objects.size).toBe(0);
    expect(fake.deletedBooking).toEqual([]);

    fake.setBookingDeleteShouldFail(false);
    const retry = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(retry).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 8: retry after full success is already_deleted", async () => {
    const fake = createFakeStore([proofPath(PROOF_A)]);
    const first = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(first.ok).toBe(true);
    const retry = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(retry).toEqual({
      ok: true,
      booking_id: BOOKING_ID,
      already_deleted: true,
      proof_objects_deleted: 0,
    });
  });
});
