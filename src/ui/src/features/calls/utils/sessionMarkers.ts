/**
 * Call continuity markers. sessionStorage survives refresh and crash-restore
 * (silent auto-rejoin); localStorage survives a full browser restart (rejoin
 * prompt). Both carry a timestamp so stale markers never trigger anything, and
 * the organization so a tab only rejoins calls of the org it is in.
 */

export interface CallSessionMarker {
  callId: string;
  channelId: string;
  organizationId: string;
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
    if (!marker.callId || !marker.channelId || !marker.organizationId) return null;
    if (typeof marker.ts !== "number") return null;
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

/**
 * With an organization, the device-wide marker goes only when it names that org: it may be a call
 * another tab left in a different organization.
 */
export function clearCallMarkers(organizationId?: string): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    const recent = readRecentMarker();
    if (!organizationId || !recent || recent.organizationId === organizationId) {
      localStorage.removeItem(RECENT_KEY);
    }
  } catch {
    // Best-effort.
  }
}
