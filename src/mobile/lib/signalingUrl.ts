import { ENV } from "@/constants/env";

// The backend relays LIVEKIT_WS_URL verbatim: either a path (default
// "/livekit") that web clients resolve against window.location, or an
// absolute ws(s):// override for split-origin deployments. Native has no
// window.location, so a path resolves against the API origin - which is only
// correct when EXPO_PUBLIC_API_URL points at the edge proxy (the backend
// itself does not proxy /livekit). EXPO_PUBLIC_LIVEKIT_URL overrides for dev
// setups that talk to the backend port directly.
export function resolveSignalingUrl(wsUrl: string): string {
  const override = ENV.livekitUrl;
  if (override) return override;
  if (wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")) return wsUrl;

  const api = ENV.apiUrl;
  const match = /^(https?):\/\/([^/]+)/.exec(api);
  if (!match) return wsUrl;
  const proto = match[1] === "https" ? "wss" : "ws";
  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  return `${proto}://${match[2]}${path}`;
}
