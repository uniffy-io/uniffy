import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CallSessionMarker {
  organizationId: string;
  callId: string;
  channelId: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  ts: number;
}

const MARKER_KEY = "uniffy_call_session";

// A killed app always comes back as a cold start, so there is no silent-rejoin
// tier here - the marker only ever drives a prompt, and one older than this is
// far more likely to name a call that has since ended than one worth offering.
const MARKER_TTL_MS = 10 * 60 * 1000;

export async function writeCallMarker(marker: CallSessionMarker): Promise<void> {
  try {
    await AsyncStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    // Continuity is best-effort.
  }
}

export async function readCallMarker(): Promise<CallSessionMarker | null> {
  try {
    const raw = await AsyncStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as CallSessionMarker;
    if (
      !marker.organizationId ||
      !marker.callId ||
      !marker.channelId ||
      typeof marker.ts !== "number"
    ) {
      return null;
    }
    if (Date.now() - marker.ts > MARKER_TTL_MS) return null;
    return marker;
  } catch {
    return null;
  }
}

export async function clearCallMarker(): Promise<void> {
  try {
    await AsyncStorage.removeItem(MARKER_KEY);
  } catch {
    // Best-effort.
  }
}
