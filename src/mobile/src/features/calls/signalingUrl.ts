import { getApiBaseUrl } from "@core/config/serverUrl";

// The backend relays LIVEKIT_WS_URL verbatim: either an absolute ws(s):// URL
// for split-origin deployments (returned as-is), or a path (default
// "/livekit") that web clients resolve against window.location. Native has no
// window.location, so a path resolves against the chosen server origin - which
// is correct when that server's edge proxies /livekit.
export function resolveSignalingUrl(wsUrl: string): string {
  if (wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")) return wsUrl;

  const api = getApiBaseUrl();
  const match = /^(https?):\/\/([^/]+)/.exec(api);
  if (!match) return wsUrl;
  const proto = match[1] === "https" ? "wss" : "ws";
  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  return `${proto}://${match[2]}${path}`;
}
