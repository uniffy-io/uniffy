import { Platform } from "react-native";
import { getServerUrl } from "@core/config/serverUrl";
import { getAccessToken, getAssetCookie } from "@core/auth/auth";
import { getTokenExpiryMs } from "@core/auth/jwt";

// Backend-built asset URLs (avatars) are origin-relative /api/... paths;
// resolve them against the chosen server origin so native image loaders can
// fetch them.
export function resolveAssetUrl(url: string): string {
  return url.startsWith("/") ? `${getServerUrl()}${url}` : url;
}

// GET asset requests (expo-image, WebView, downloads, audio) authenticate with
// the read-only asset cookie sent as an explicit Cookie header - least
// privilege and a longer TTL than the access token. The Bearer fallback covers
// the web build, where a manual Cookie header is a forbidden header name.
export function assetAuthHeaders(): Record<string, string> {
  if (Platform.OS !== "web") {
    const cookie = getAssetCookie();
    if (cookie) return { Cookie: cookie };
  }
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Whether the credential assetAuthHeaders() would attach is already expired.
// Image error handlers use this to tell a stale-auth 401 (worth a token
// refresh + retry) from an ordinary missing asset.
export function assetAuthStale(): boolean {
  const cookie = getAssetCookie();
  const token = cookie ? cookie.slice(cookie.indexOf("=") + 1) : getAccessToken();
  if (!token) return true;
  const expiry = getTokenExpiryMs(token);
  return expiry !== null && expiry <= Date.now();
}
