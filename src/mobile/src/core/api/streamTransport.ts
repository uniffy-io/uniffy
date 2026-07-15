import { createConnectTransport } from "@connectrpc/connect-web";
import { fetch as expoFetch } from "expo/fetch";
import { SENTINEL_BASE_URL, serverRewritingFetch } from "@core/api/baseFetch";
import { createAuthInterceptor } from "@core/api/authInterceptor";

// expo/fetch (WinterCG fetch) supports streaming response bodies, which React
// Native's built-in fetch does not. Server-streaming RPCs must use this
// transport; unary RPCs stay on core/api/transport. No reactive 401 retry
// here - stream consumers own reconnection (see authInterceptor).
export const streamTransport = createConnectTransport({
  baseUrl: SENTINEL_BASE_URL,
  interceptors: [createAuthInterceptor({ retryOn401: false })],
  fetch: serverRewritingFetch(expoFetch as unknown as typeof globalThis.fetch),
});
