/**
 * The backend relays LIVEKIT_WS_URL verbatim in join responses. A path value
 * (the default, `/livekit`) resolves against the current origin so localhost,
 * SSH tunnels, and customer domains all work with zero config and CSP stays
 * `connect-src 'self'`. An absolute ws(s):// value is the split-origin
 * override and is used verbatim.
 */
export function resolveSignalingUrl(wsUrl: string): string {
  if (wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")) return wsUrl;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  return `${proto}//${window.location.host}${path}`;
}
