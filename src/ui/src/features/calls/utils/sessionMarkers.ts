/**
 * Call continuity markers. sessionStorage survives refresh and crash-restore
 * (silent auto-rejoin); localStorage survives a full browser restart (rejoin
 * prompt). Both carry a timestamp so stale markers never trigger anything.
 */

export interface CallSessionMarker {
  callId: string;
  channelId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  ts: number;
}

const SESSION_KEY = "uniffy-call-session";
const RECENT_KEY = "uniffy-recent-call";

const SESSION_MARKER_TTL_MS = 5 * 60 * 1000;
const RECENT_MARKER_TTL_MS = 10 * 60 * 1000;

function parse(raw: string | null, ttlMs: number): CallSessionMarker | null {
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as CallSessionMarker;
    if (!marker.callId || !marker.channelId || typeof marker.ts !== "number") return null;
    if (Date.now() - marker.ts > ttlMs) return null;
    return marker;
  } catch {
    return null;
  }
}

export function writeCallMarkers(marker: CallSessionMarker): void {
  const raw = JSON.stringify(marker);
  try {
    sessionStorage.setItem(SESSION_KEY, raw);
    localStorage.setItem(RECENT_KEY, raw);
  } catch {
    // Storage full or blocked; continuity is best-effort.
  }
}

/** Read-and-remove: an auto-rejoin marker must only ever fire once. */
export function consumeSessionMarker(): CallSessionMarker | null {
  try {
    const marker = parse(sessionStorage.getItem(SESSION_KEY), SESSION_MARKER_TTL_MS);
    sessionStorage.removeItem(SESSION_KEY);
    return marker;
  } catch {
    return null;
  }
}

export function readRecentMarker(): CallSessionMarker | null {
  try {
    return parse(localStorage.getItem(RECENT_KEY), RECENT_MARKER_TTL_MS);
  } catch {
    return null;
  }
}

export function clearCallMarkers(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Best-effort.
  }
}
