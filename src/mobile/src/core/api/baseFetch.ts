import { getApiBaseUrl } from "@core/config/serverUrl";

// ConnectRPC bakes a static baseUrl into each transport at creation time, but
// the server is not known until login. Transports are created with this
// sentinel base and this wrapper swaps it for the live server base on every
// request, so switching servers takes effect without rebuilding the clients.
// The `.invalid` TLD never resolves, so a request would only fail loudly if a
// rewrite were ever missed.
export const SENTINEL_BASE_URL = "http://uniffy.invalid/api";

// React Native's Android fetch has no native timeouts (OkHttp is built with
// them disabled), so without a deadline a black-holed request hangs forever.
// Applies to the unary transports only; the long-lived event stream manages
// its own liveness via the server heartbeat watchdog. Interactive reads and
// writes should fail fast enough for the UI to react; RPCs that legitimately
// run long (chunk pushes, server-side storage copies) override per call with
// the slow tier.
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;
export const SLOW_RPC_TIMEOUT_MS = 60_000;

// Image generation runs to a 300s server-side budget, so the slow tier would
// abort it two thirds of the way through. The client would report a failure the
// server never sees, having already charged the spend. Its own tier rather than
// a wider slow tier, which uploads and bulk file ops share and should keep
// failing fast.
export const IMAGE_RPC_TIMEOUT_MS = 320_000;

export function serverRewritingFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const swap = (url: string): string =>
    url.startsWith(SENTINEL_BASE_URL) ? getApiBaseUrl() + url.slice(SENTINEL_BASE_URL.length) : url;

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") return baseFetch(swap(input), init);
    if (input instanceof URL) return baseFetch(swap(input.toString()), init);
    if (input instanceof Request) return baseFetch(new Request(swap(input.url), input), init);
    return baseFetch(input, init);
  }) as typeof globalThis.fetch;
}
