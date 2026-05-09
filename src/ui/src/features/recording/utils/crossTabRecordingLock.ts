/**
 * Cross-tab single-recording lock.
 *
 * Two tabs of the same origin running concurrent recordings would each
 * try to grab the screen, fight over upload bandwidth, double-charge the
 * user's quota, and surface confusing race conditions in the slice.
 *
 * The lock is a soft, advisory `BroadcastChannel` protocol:
 *
 *   - On `acquireLock()`, this tab broadcasts `who-holds?`. Any active
 *     holder responds `held` with its `ownerId`. If a response arrives
 *     within 150ms, this tab gives up and returns `held-by-other`.
 *   - On a clean acquire, this tab starts heartbeating `held` every
 *     5 seconds. Listeners that miss two heartbeats (~12s) treat the
 *     holder as gone and clear their "another tab is recording" badge.
 *   - On `releaseLock()`, this tab broadcasts `released` and stops the
 *     heartbeat.
 *
 * This is best-effort: a frozen tab won't actively release. The 12s
 * miss timeout covers the freeze case. A user can still bypass by
 * disabling BroadcastChannel (private mode quirks); we accept that and
 * fall through to a no-op (the worst case is two recordings, not data
 * corruption - the server-side `MultipartUpload` rows are independent).
 */

const CHANNEL_NAME = 'uniffy-recording';
const HEARTBEAT_INTERVAL_MS = 5_000;
const ACQUIRE_TIMEOUT_MS = 150;
const STALE_HOLDER_MS = 12_000;

type Message =
    | { kind: 'who-holds'; askerId: string }
    | { kind: 'held'; ownerId: string; ts: number }
    | { kind: 'released'; ownerId: string };

let channel: BroadcastChannel | null = null;
let heldOwnerId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastSeenHolder: { ownerId: string; ts: number } | null = null;

const availabilityListeners = new Set<(otherTabHolding: boolean) => void>();

function getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.addEventListener('message', handleMessage);
        return channel;
    } catch {
        return null;
    }
}

function genOwnerId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
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
        case 'who-holds': {
            if (heldOwnerId !== null) {
                channel?.postMessage({
                    kind: 'held',
                    ownerId: heldOwnerId,
                    ts: Date.now(),
                });
            }
            break;
        }
        case 'held': {
            if (heldOwnerId === null) {
                lastSeenHolder = { ownerId: msg.ownerId, ts: msg.ts };
                notifyListeners();
            }
            break;
        }
        case 'released': {
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
    /** Set when `acquired` is false: the id of the tab currently recording. */
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
            if (event.data?.kind === 'held') {
                foundHolder = event.data.ownerId;
                ch.removeEventListener('message', onProbeReply);
                resolve();
            }
        };
        ch.addEventListener('message', onProbeReply);
        ch.postMessage({ kind: 'who-holds', askerId: myId });
        setTimeout(() => {
            ch.removeEventListener('message', onProbeReply);
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
    channel?.postMessage({ kind: 'released', ownerId });
    notifyListeners();
}

function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (heldOwnerId !== null) {
            channel?.postMessage({
                kind: 'held',
                ownerId: heldOwnerId,
                ts: Date.now(),
            });
        }
    }, HEARTBEAT_INTERVAL_MS);
    // Fire once immediately so peers know about us before the first
    // interval elapses.
    channel?.postMessage({
        kind: 'held',
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

export function subscribeAvailability(
    cb: (otherTabHolding: boolean) => void,
): () => void {
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

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (heldOwnerId !== null) {
            channel?.postMessage({ kind: 'released', ownerId: heldOwnerId });
        }
    });
}
