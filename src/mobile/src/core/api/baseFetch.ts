import { getApiBaseUrl } from "@core/config/serverUrl";

// ConnectRPC bakes a static baseUrl into each transport at creation time, but
// the server is not known until login. Transports are created with this
// sentinel base and this wrapper swaps it for the live server base on every
// request, so switching servers takes effect without rebuilding the clients.
// The `.invalid` TLD never resolves, so a request would only fail loudly if a
// rewrite were ever missed.
export const SENTINEL_BASE_URL = "http://uniffy.invalid/api";

export function serverRewritingFetch(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const swap = (url: string): string =>
    url.startsWith(SENTINEL_BASE_URL)
      ? getApiBaseUrl() + url.slice(SENTINEL_BASE_URL.length)
      : url;

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") return baseFetch(swap(input), init);
    if (input instanceof URL) return baseFetch(swap(input.toString()), init);
    if (input instanceof Request) return baseFetch(new Request(swap(input.url), input), init);
    return baseFetch(input, init);
  }) as typeof globalThis.fetch;
}
