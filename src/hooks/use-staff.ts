import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyOperatorProfile } from "@/lib/operator";
import {
  STAFF_QUERY_KEYS,
  countUnread,
  fetchLatestStaffMessages,
  fetchMyReads,
  fetchStaffDirectory,
  fetchThreadMessages,
  markThreadRead,
  setMyLocationSharing,
  shouldSendLocation,
  threadKey,
  upsertMyLocation,
  type StaffMessage,
} from "@/lib/staff";

/** Staff row (id/role) of the signed-in user — works for owner, admin and operator. */
export function useMyStaff() {
  const q = useQuery({
    queryKey: ["staff", "me"],
    queryFn: async () => {
      const { profile, error } = await fetchMyOperatorProfile();
      if (error) throw new Error(error);
      return profile;
    },
    staleTime: 5 * 60_000,
  });
  const profile = q.data ?? null;
  return {
    staffId: profile?.staff_id ?? null,
    role: profile?.role ?? null,
    isAdmin: profile?.role === "owner" || profile?.role === "admin",
    loading: q.isLoading,
  };
}

export function useStaffDirectory() {
  const q = useQuery({
    queryKey: STAFF_QUERY_KEYS.directory,
    queryFn: fetchStaffDirectory,
    staleTime: 5 * 60_000,
  });
  const byId = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of q.data ?? []) m.set(row.staff_id, row.display_name);
    return m;
  }, [q.data]);
  return { ...q, byId };
}

// ---------------------------------------------------------------------------
// Location sharing (driver side)
// ---------------------------------------------------------------------------

const SHARE_STORAGE_KEY = "washero_share_location";

export type LocationShareStatus =
  | "off"
  | "requesting"
  | "active"
  | "denied"
  | "unsupported"
  | "error";

function readSharePreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SHARE_STORAGE_KEY) !== "off";
}

/**
 * Shares the device position while the PWA is open. Browsers stop GPS when the
 * app is closed or backgrounded (especially iOS), so this is "live while in use".
 */
export function useLocationSharing(staffId: string | null) {
  const [enabled, setEnabledState] = useState<boolean>(readSharePreference);
  const [status, setStatus] = useState<LocationShareStatus>("off");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const lastRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      window.localStorage.setItem(SHARE_STORAGE_KEY, next ? "on" : "off");
      if (!next && staffId) void setMyLocationSharing(staffId, false).catch(() => undefined);
    },
    [staffId],
  );

  useEffect(() => {
    if (!staffId || !enabled) {
      setStatus("off");
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    lastRef.current = null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("active");
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
        if (!shouldSendLocation({ last: lastRef.current, next })) return;
        lastRef.current = next;
        void upsertMyLocation({
          staffId,
          lat: next.lat,
          lng: next.lng,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed ?? null,
        })
          .then(() => setLastSentAt(next.at))
          .catch((err) => {
            console.warn("[location] upsert failed", err);
            lastRef.current = null;
          });
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [staffId, enabled]);

  return { enabled, setEnabled, status, lastSentAt };
}

// ---------------------------------------------------------------------------
// Intranet
// ---------------------------------------------------------------------------

/** Subscribes to staff_messages inserts and refreshes chat queries. */
export function useStaffMessagesRealtime(onInsert?: (m: StaffMessage) => void) {
  const qc = useQueryClient();
  const cbRef = useRef(onInsert);
  cbRef.current = onInsert;
  useEffect(() => {
    const channel = supabase
      .channel(`staff-messages-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_messages" },
        (payload) => {
          const msg = payload.new as StaffMessage;
          qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.thread(threadKey(msg.thread_staff_id)) });
          qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.latest });
          cbRef.current?.(msg);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function useStaffThread(threadStaffId: string | null, myStaffId: string | null, open = true) {
  const qc = useQueryClient();
  const key = threadKey(threadStaffId);
  const q = useQuery({
    queryKey: STAFF_QUERY_KEYS.thread(key),
    queryFn: () => fetchThreadMessages(threadStaffId),
    enabled: open,
  });

  const lastId = q.data?.[q.data.length - 1]?.id;
  useEffect(() => {
    if (!open || !myStaffId || !q.data) return;
    void markThreadRead(myStaffId, key)
      .then(() => qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.reads }))
      .catch(() => undefined);
  }, [open, myStaffId, key, lastId, q.data, qc]);

  return q;
}

/** Latest messages + read markers → per-thread unread counts and previews. */
export function useStaffInbox(myStaffId: string | null) {
  const latest = useQuery({
    queryKey: STAFF_QUERY_KEYS.latest,
    queryFn: () => fetchLatestStaffMessages(),
    enabled: !!myStaffId,
  });
  const reads = useQuery({
    queryKey: STAFF_QUERY_KEYS.reads,
    queryFn: fetchMyReads,
    enabled: !!myStaffId,
  });

  return useMemo(() => {
    const byThread = new Map<string, StaffMessage[]>();
    for (const m of latest.data ?? []) {
      const k = threadKey(m.thread_staff_id);
      const list = byThread.get(k) ?? [];
      list.push(m);
      byThread.set(k, list);
    }
    const unread: Record<string, number> = {};
    const preview: Record<string, StaffMessage | undefined> = {};
    let totalUnread = 0;
    for (const [k, list] of byThread) {
      const n = countUnread(list, reads.data?.[k], myStaffId);
      unread[k] = n;
      totalUnread += n;
      preview[k] = list[0]; // newest first
    }
    return { unread, preview, totalUnread, loading: latest.isLoading || reads.isLoading };
  }, [latest.data, latest.isLoading, reads.data, reads.isLoading, myStaffId]);
}
