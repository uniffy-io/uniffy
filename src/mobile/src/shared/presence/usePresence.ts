import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { PresenceStatus } from "@uniffy/proto/presence/v1/presence_pb";
import { presenceApi } from "@shared/presence/presenceApi";
import { useAuth } from "@core/providers/auth-context";

// Matches the web heartbeat cadence so the backend stale-presence GC keeps
// both clients on the same offline threshold.
const HEARTBEAT_INTERVAL_MS = 60_000;
const PRESENCE_REFRESH_MS = 60_000;

const STATUS_LABELS: Record<number, string> = {
  [PresenceStatus.ONLINE]: "online",
  [PresenceStatus.AWAY]: "away",
  [PresenceStatus.DND]: "dnd",
  [PresenceStatus.OFFLINE]: "offline",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reports this device's presence while the app is foregrounded and marks the
 * user away the moment it backgrounds - RN timers freeze in background, so
 * the transition itself is the only reliable away signal.
 */
export function usePresenceHeartbeat() {
  const { isAuthenticated, organizationId } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !organizationId) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const send = (status: PresenceStatus) => {
      presenceApi.setPresence({ organizationId, status, client: "mobile" }).catch(() => {});
    };

    const start = () => {
      send(PresenceStatus.ONLINE);
      if (!interval) {
        interval = setInterval(() => send(PresenceStatus.ONLINE), HEARTBEAT_INTERVAL_MS);
      }
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        start();
      } else {
        stop();
        send(PresenceStatus.AWAY);
      }
    });

    return () => {
      sub.remove();
      stop();
    };
  }, [isAuthenticated, organizationId]);
}

/**
 * Bulk presence for the given user ids as status strings ("online", "away",
 * "dnd", "offline"). Polled - mobile has no presence event stream.
 */
export function usePresences(userIds: string[]): Record<string, string> {
  const { organizationId } = useAuth();
  // Non-UUID subjects (agents, placeholders) make the backend reject the
  // whole bulk request with INVALID_ARGUMENT.
  const ids = useMemo(
    () => [...new Set(userIds.filter((id) => UUID_RE.test(id)))].sort(),
    [userIds],
  );

  const query = useQuery({
    queryKey: ["presence", organizationId ?? "", ids.join(",")],
    enabled: !!organizationId && ids.length > 0,
    staleTime: 30_000,
    refetchInterval: PRESENCE_REFRESH_MS,
    queryFn: async () => {
      const res = await presenceApi.getBulkPresence({
        organizationId: organizationId ?? "",
        userIds: ids,
      });
      const statuses: Record<string, string> = {};
      for (const [userId, presence] of Object.entries(res.presences)) {
        statuses[userId] = STATUS_LABELS[presence.status] ?? "offline";
      }
      return statuses;
    },
  });

  return query.data ?? {};
}
