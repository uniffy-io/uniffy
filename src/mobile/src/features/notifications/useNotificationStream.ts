import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  StreamNotificationsResponse_EventType,
  type StreamNotificationsResponse,
} from "@uniffy/proto/notifications/v1/notifications_pb";
import { notificationStreamApi } from "@features/notifications/notificationStreamApi";
import { useAuth } from "@core/providers/AuthContext";
import { addOnlineListener } from "@core/api/connectivity";

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
// The server heartbeats periodically; prolonged silence means a half-open
// socket (LTE, iOS suspending sockets in background) the platform never errors.
const STREAM_IDLE_LIMIT_MS = 75000;
const WATCHDOG_TICK_MS = 15000;
// On a foreground/online kick, one missed heartbeat plus slack is enough to
// abandon the current socket rather than wait out the watchdog.
const KICK_STALE_MS = 35000;

let refCount = 0;
let controller: AbortController | null = null;
let attemptController: AbortController | null = null;
let lastEventAtMs = 0;
let currentOrgId: string | null = null;
let lifecycleUnsubs: (() => void)[] = [];
let sleepWakers: (() => void)[] = [];

/**
 * Subscribes the app to the server notification stream so presence and the
 * notification bell reflect changes in real time instead of on the poll
 * cadence. A single module-level connection is shared across every mounted
 * subscriber; if the platform fetch cannot consume the server stream the loop
 * retries with backoff and the polling queries keep working underneath.
 */
export function useNotificationStream() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) return;
    refCount++;
    if (!controller || currentOrgId !== organizationId) {
      start(organizationId, queryClient);
    }
    return () => {
      refCount--;
      if (refCount <= 0) {
        refCount = 0;
        stop();
      }
    };
  }, [organizationId, queryClient]);
}

function start(orgId: string, queryClient: QueryClient) {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  currentOrgId = orgId;
  for (const unsub of lifecycleUnsubs) unsub();
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") kick();
  });
  const removeOnline = addOnlineListener((online) => {
    if (online) kick();
  });
  lifecycleUnsubs = [() => appStateSub.remove(), removeOnline];
  void runLoop(orgId, queryClient, ctl);
}

function stop() {
  controller?.abort();
  controller = null;
  currentOrgId = null;
  for (const unsub of lifecycleUnsubs) unsub();
  lifecycleUnsubs = [];
}

// Foreground or connectivity regained: skip any backoff sleep, and drop the
// current socket when it has already missed a heartbeat (likely dead after
// background suspension or a network switch).
function kick() {
  if (attemptController && Date.now() - lastEventAtMs > KICK_STALE_MS) {
    attemptController.abort();
  }
  const wakers = sleepWakers;
  sleepWakers = [];
  for (const wake of wakers) wake();
}

async function runLoop(orgId: string, queryClient: QueryClient, ctl: AbortController) {
  let backoffMs = RECONNECT_BASE_MS;
  while (!ctl.signal.aborted) {
    const attempt = new AbortController();
    attemptController = attempt;
    const onOuterAbort = () => attempt.abort();
    ctl.signal.addEventListener("abort", onOuterAbort, { once: true });
    lastEventAtMs = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAtMs > STREAM_IDLE_LIMIT_MS) attempt.abort();
    }, WATCHDOG_TICK_MS);
    try {
      const stream = notificationStreamApi.streamNotifications(
        { organizationId: orgId },
        { signal: attempt.signal },
      );
      for await (const event of stream) {
        if (attempt.signal.aborted) break;
        lastEventAtMs = Date.now();
        backoffMs = RECONNECT_BASE_MS;
        applyNotificationEvent(orgId, queryClient, event);
      }
    } catch {
      // Network drop, watchdog abort, or a platform fetch that cannot consume
      // server streams; the polling queries stay the fallback.
    } finally {
      clearInterval(watchdog);
      ctl.signal.removeEventListener("abort", onOuterAbort);
      if (attemptController === attempt) attemptController = null;
    }
    if (ctl.signal.aborted) break;
    await sleep(jitter(backoffMs), ctl.signal);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }
}

// Desynchronizes reconnects across clients so a server restart is not hammered
// by every device on the same beat.
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      sleepWakers = sleepWakers.filter((w) => w !== finish);
      resolve();
    };
    const t = setTimeout(finish, ms);
    sleepWakers.push(finish);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function applyNotificationEvent(
  orgId: string,
  queryClient: QueryClient,
  event: StreamNotificationsResponse,
) {
  switch (event.eventType) {
    case StreamNotificationsResponse_EventType.PRESENCE_CHANGED: {
      const pc = event.presenceChanged;
      if (pc) applyPresenceChange(queryClient, orgId, pc.userId, pc.status);
      break;
    }
    case StreamNotificationsResponse_EventType.NEW_NOTIFICATION: {
      void queryClient.invalidateQueries({ queryKey: ["notifications", "feed", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count", orgId] });
      break;
    }
    default:
      break;
  }
}

// Presence is cached per requested id-set (key: ["presence", org, ids.join(",")]).
// Patch every live entry for this org whose id-set includes the user, so the
// online dot flips instantly wherever it shows instead of waiting for the poll.
// The server only pushes online/away transitions; offline still rides the poll
// (it expires by TTL server-side and is never published).
function applyPresenceChange(
  queryClient: QueryClient,
  orgId: string,
  userId: string,
  status: string,
) {
  const entries = queryClient.getQueriesData<Record<string, string>>({ queryKey: ["presence"] });
  for (const [key, value] of entries) {
    if (key[1] !== orgId) continue;
    const idsPart = key[2];
    if (typeof idsPart !== "string") continue;
    if (!idsPart.split(",").includes(userId)) continue;
    queryClient.setQueryData(key, { ...(value ?? {}), [userId]: status });
  }
}
