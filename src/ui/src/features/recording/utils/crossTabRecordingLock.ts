/**
 * Cross-tab single-recording advisory lock over BroadcastChannel. Probe with 150ms timeout;
 * 5s heartbeats and 12s stale-holder timeout cover frozen tabs. Falls through to no-op when
 * BroadcastChannel is unavailable (worst case: two concurrent recordings, no data corruption).
 */

const CHANNEL_NAME = "uniffy-recording";
const HEARTBEAT_INTERVAL_MS = 5_000;
const ACQUIRE_TIMEOUT_MS = 150;
const STALE_HOLDER_MS = 12_000;

type Message =
  | { kind: "who-holds"; askerId: string }
  | { kind: "held"; ownerId: string; ts: number }
  | { kind: "released"; ownerId: string };

let channel: BroadcastChannel | null = null;
let heldOwnerId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastSeenHolder: { ownerId: string; ts: number } | null = null;

const availabilityListeners = new Set<(otherTabHolding: boolean) => void>();

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", handleMessage);
    return channel;
  } catch {
    return null;
  }
}

function genOwnerId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function notifyListeners(): void {
  const otherHolding = isAnotherTabHolding();
  for (const cb of availabilityListeners) {
    cb(otherHolding);
  }
}

function isAnotherTabHolding(): boolean {
  if (heldOwnerId !== null) return false;
  if (!lastSeenHolder) return false;
  return Date.now() - lastSeenHolder.ts <= STALE_HOLDER_MS;
}

function handleMessage(event: MessageEvent<Message>): void {
  const msg = event.data;
  if (!msg) return;
  switch (msg.kind) {
    case "who-holds": {
      if (heldOwnerId !== null) {
        channel?.postMessage({
          kind: "held",
          ownerId: heldOwnerId,
          ts: Date.now(),
        });
      }
      break;
    }
    case "held": {
      if (heldOwnerId === null) {
        lastSeenHolder = { ownerId: msg.ownerId, ts: msg.ts };
        notifyListeners();
      }
      break;
    }
    case "released": {
      if (lastSeenHolder?.ownerId === msg.ownerId) {
        lastSeenHolder = null;
        notifyListeners();
      }
      break;
    }
  }
}

export interface AcquireResult {
  acquired: boolean;
  ownerId: string | null;
  heldByOwnerId: string | null;
}

export async function acquireLock(): Promise<AcquireResult> {
  const ch = getChannel();
  if (!ch) {
    // No BroadcastChannel: degrade to single-tab assumption.
    const ownerId = genOwnerId();
    heldOwnerId = ownerId;
    return { acquired: true, ownerId, heldByOwnerId: null };
  }

  const myId = genOwnerId();
  let foundHolder: string | null = null;

  const probe = new Promise<void>((resolve) => {
    const onProbeReply = (event: MessageEvent<Message>) => {
      if (event.data?.kind === "held") {
        foundHolder = event.data.ownerId;
        ch.removeEventListener("message", onProbeReply);
        resolve();
      }
    };
    ch.addEventListener("message", onProbeReply);
    ch.postMessage({ kind: "who-holds", askerId: myId });
    setTimeout(() => {
      ch.removeEventListener("message", onProbeReply);
      resolve();
    }, ACQUIRE_TIMEOUT_MS);
  });

  await probe;

  if (foundHolder) {
    return { acquired: false, ownerId: null, heldByOwnerId: foundHolder };
  }

  heldOwnerId = myId;
  lastSeenHolder = null;
  notifyListeners();
  startHeartbeat();
  return { acquired: true, ownerId: myId, heldByOwnerId: null };
}

export function releaseLock(): void {
  if (heldOwnerId === null) return;
  const ownerId = heldOwnerId;
  heldOwnerId = null;
  stopHeartbeat();
  channel?.postMessage({ kind: "released", ownerId });
  notifyListeners();
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (heldOwnerId !== null) {
      channel?.postMessage({
        kind: "held",
        ownerId: heldOwnerId,
        ts: Date.now(),
      });
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Fire once immediately so peers learn about us before the first interval.
  channel?.postMessage({
    kind: "held",
    ownerId: heldOwnerId!,
    ts: Date.now(),
  });
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function subscribeAvailability(cb: (otherTabHolding: boolean) => void): () => void {
  getChannel();
  availabilityListeners.add(cb);
  cb(isAnotherTabHolding());
  return () => {
    availabilityListeners.delete(cb);
  };
}

export function isHeldByThisTab(): boolean {
  return heldOwnerId !== null;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (heldOwnerId !== null) {
      channel?.postMessage({ kind: "released", ownerId: heldOwnerId });
    }
  });
}
