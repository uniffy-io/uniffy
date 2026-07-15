import AsyncStorage from "@react-native-async-storage/async-storage";

// The server is chosen at login (clients point the app at their own
// deployment), so it cannot be a build-time constant. It lives here as a
// mutable origin that the transports and asset/file URL builders read at
// request time, defaulting to staging until the user picks one.
export const DEFAULT_SERVER_URL = "https://staging.uniffy.io";

const SERVER_URL_KEY = "uniffy_server_url";

// Accepts what a user types ("acme.uniffy.io", "https://acme.uniffy.io/api/")
// and returns a bare origin with no scheme-less host, no trailing slash, and no
// trailing /api - getApiBaseUrl() is the single place /api is appended.
export function normalizeServerUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return DEFAULT_SERVER_URL;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  value = value.replace(/\/+$/, "");
  value = value.replace(/\/api$/i, "");
  return value.replace(/\/+$/, "");
}

let serverOrigin = DEFAULT_SERVER_URL;

// Origin only (no /api) - asset URLs are origin-relative /api/... paths.
export function getServerUrl(): string {
  return serverOrigin;
}

// API base the ConnectRPC transports and file/media routes hit.
export function getApiBaseUrl(): string {
  return `${serverOrigin}/api`;
}

// Load the persisted choice before the first request. Falls back to the
// env/staging seed when nothing is stored or storage is unavailable.
export async function hydrateServerUrl(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
    if (stored) serverOrigin = stored;
  } catch {
    // keep the seed
  }
}

// Set the live origin and persist it. Takes effect immediately for every
// transport (they resolve the base per request) and survives a cold start.
export async function setServerUrl(raw: string): Promise<void> {
  serverOrigin = normalizeServerUrl(raw);
  try {
    await AsyncStorage.setItem(SERVER_URL_KEY, serverOrigin);
  } catch {
    // the in-memory origin still applies for this session
  }
}
