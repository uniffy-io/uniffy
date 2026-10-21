import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import { getAccessToken } from "@core/auth/auth";
import { isTokenExpiring } from "@core/auth/jwt";
import { refreshAfterMembershipDenial, refreshSession } from "@core/auth/refresh";
import { clientUserAgent } from "@core/api/userAgent";

const userAgent = clientUserAgent();

// No generated descriptor exists for google.rpc.ErrorInfo, so its two string fields are read off
// the wire: reason is field 1, domain is field 2.
const ERROR_INFO_TYPE = "google.rpc.ErrorInfo";
const ERROR_INFO_DOMAIN = "uniffy";
const MEMBERSHIP_REQUIRED_REASON = "membership_required";

function readErrorInfo(value: Uint8Array): { reason: string; domain: string } | null {
  try {
    const reader = new BinaryReader(value);
    let reason = "";
    let domain = "";
    while (reader.pos < reader.len) {
      const [field, wireType] = reader.tag();
      if (field === 1 && wireType === WireType.LengthDelimited) reason = reader.string();
      else if (field === 2 && wireType === WireType.LengthDelimited) domain = reader.string();
      else reader.skip(wireType, field);
    }
    return { reason, domain };
  } catch {
    return null;
  }
}

/** The server refused because the caller is no active member of the organization. Only a hint:
 * a refresh decides whether the grant is gone. */
export function isMembershipDenial(err: unknown): boolean {
  if (!(err instanceof ConnectError) || err.code !== Code.PermissionDenied) return false;
  return err.details.some((detail) => {
    if (!("type" in detail) || detail.type !== ERROR_INFO_TYPE) return false;
    const info = readErrorInfo(detail.value);
    return info?.domain === ERROR_INFO_DOMAIN && info.reason === MEMBERSHIP_REQUIRED_REASON;
  });
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

    try {
      return await next(req);
    } catch (err) {
      // A removal from the organization would otherwise show only at the next expiry refresh.
      // The refusal still reaches the caller; the refresh resets the app if the grant is gone.
      if (token && isMembershipDenial(err))
        void refreshAfterMembershipDenial(token).catch(() => {});
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
