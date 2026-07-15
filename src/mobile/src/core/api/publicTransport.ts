import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { SENTINEL_BASE_URL, serverRewritingFetch } from "@core/api/baseFetch";
import { clientUserAgent } from "@core/api/userAgent";

const userAgent = clientUserAgent();

// Login/register/refresh create or rotate the session row, so the device label
// is parsed from the User-Agent they send. The public transport has no auth
// interceptor, so attach the agent here too.
const userAgentInterceptor: Interceptor = (next) => async (req) => {
  if (userAgent) {
    req.header.set("User-Agent", userAgent);
  }
  return next(req);
};

// Unauthenticated transport for login/register/refresh. No Bearer token and no
// refresh-on-401: the RefreshToken RPC itself must never recurse into refresh.
export const publicTransport = createConnectTransport({
  baseUrl: SENTINEL_BASE_URL,
  interceptors: [userAgentInterceptor],
  fetch: serverRewritingFetch(globalThis.fetch),
});
