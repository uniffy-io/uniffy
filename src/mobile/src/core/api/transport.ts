import { createConnectTransport } from "@connectrpc/connect-web";
import {
  DEFAULT_RPC_TIMEOUT_MS,
  SENTINEL_BASE_URL,
  serverRewritingFetch,
} from "@core/api/baseFetch";
import { createAuthInterceptor } from "@core/api/authInterceptor";

// Binary proto like the web transports. JSON is not schema-skew tolerant: the
// python server hard-rejects a request carrying a field its proto does not
// know yet, while binary skips unknown fields, so a newer app keeps working
// against a not-yet-redeployed backend.
export const transport = createConnectTransport({
  baseUrl: SENTINEL_BASE_URL,
  useBinaryFormat: true,
  interceptors: [createAuthInterceptor({ retryOn401: true })],
  fetch: serverRewritingFetch(globalThis.fetch),
  defaultTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
});
