import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { getAccessToken } from "@core/auth/auth";
import { isTokenExpiring } from "@core/auth/jwt";
import { refreshSession } from "@core/auth/refresh";
import { clientUserAgent } from "@core/api/userAgent";

const userAgent = clientUserAgent();

// Attaches the Bearer token, refreshing it proactively when it is about to
// expire and (for unary transports) once reactively after an Unauthenticated
// response. retryOn401 stays off for streaming transports: a stream request
// cannot be safely re-sent, and the stream consumers own reconnection - their
// next attempt passes back through the proactive path with a fresh token.
export function createAuthInterceptor({ retryOn401 }: { retryOn401: boolean }): Interceptor {
  return (next) => async (req) => {
    let token = getAccessToken();
    if (token && isTokenExpiring(token)) {
      // A failed proactive refresh is not fatal here: the request goes out
      // with the stale token and the reactive path or the caller surfaces it.
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed) token = refreshed.accessToken;
    }
    if (token) {
      req.header.set("Authorization", `Bearer ${token}`);
    }
    if (userAgent) {
      req.header.set("User-Agent", userAgent);
    }

    try {
      return await next(req);
    } catch (err) {
      if (!retryOn401 || !(err instanceof ConnectError) || err.code !== Code.Unauthenticated) {
        throw err;
      }
      const refreshed = await refreshSession().catch(() => null);
      if (!refreshed) throw err;
      req.header.set("Authorization", `Bearer ${refreshed.accessToken}`);
      return next(req);
    }
  };
}
