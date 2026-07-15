import { createConnectTransport } from "@connectrpc/connect-web";
import { SENTINEL_BASE_URL, serverRewritingFetch } from "@core/api/baseFetch";
import { createAuthInterceptor } from "@core/api/authInterceptor";

export const transport = createConnectTransport({
  baseUrl: SENTINEL_BASE_URL,
  interceptors: [createAuthInterceptor({ retryOn401: true })],
  fetch: serverRewritingFetch(globalThis.fetch),
});
