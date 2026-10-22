import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { getAccessToken } from "@core/auth/auth";
import { isTokenExpiring } from "@core/auth/jwt";
import { refreshAfterMembershipDenial, refreshSession } from "@core/auth/refresh";
import { clientUserAgent } from "@core/api/userAgent";
import { decodeErrorReason } from "@core/api/errorInfo";

const userAgent = clientUserAgent();

const MEMBERSHIP_REQUIRED_REASON = "membership_required";

/** The server refused because the caller is no active member of the organization. Only a hint:
 * a refresh decides whether the grant is gone. */
export function isMembershipDenial(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    err.code === Code.PermissionDenied &&
    decodeErrorReason(err) === MEMBERSHIP_REQUIRED_REASON
  );
}

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

    const checkMembership = (err: unknown) => {
      if (token && isMembershipDenial(err))
        void refreshAfterMembershipDenial(token).catch(() => {});
    };
    try {
      const response = await next(req);
      if (!response.stream) return response;
      const messages = response.message;
      return {
        ...response,
        message: (async function* () {
          try {
            yield* messages;
          } catch (err) {
            checkMembership(err);
            throw err;
          }
        })(),
      };
    } catch (err) {
      // A removal from the organization would otherwise show only at the next expiry refresh.
      // The refusal still reaches the caller; the refresh resets the app if the grant is gone.
      checkMembership(err);
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
