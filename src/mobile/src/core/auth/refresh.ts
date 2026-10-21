import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { RefreshTokenResponse } from "@uniffy/proto/auth/v1/auth_pb";
import { publicTransport } from "@core/api/publicTransport";
import {
  clearAuthStorage,
  clearStoredOrgId,
  getRefreshToken,
  getStoredOrgId,
  getStoredOrgSlug,
  setAccessToken,
  setAssetCookie,
  setRefreshToken,
  setStoredOrgId,
} from "@core/auth/auth";
import { emitOrganizationLost, emitSessionExpired } from "@core/auth/sessionEvents";

const client = createClient(AuthService, publicTransport);

let lockTail: Promise<unknown> = Promise.resolve();
let inFlight: Promise<RefreshTokenResponse | null> | null = null;

// The server rotates the refresh token on every call, so each call that spends it waits for the
// previous one. Two calls racing one token leave storage holding whichever rotation landed last,
// and replaying that token after the grace window revokes every session. A task must not await
// refreshSession, which would queue behind the task itself.
export function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lockTail.then(task);
  lockTail = run.catch(() => undefined);
  return run;
}

// Single-flight: concurrent 401s and proactive expiry checks share one round-trip.
export function refreshSession(): Promise<RefreshTokenResponse | null> {
  if (!inFlight) {
    inFlight = withRefreshLock(doRefresh).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function isAuthRejection(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    (err.code === Code.Unauthenticated || err.code === Code.PermissionDenied)
  );
}

async function doRefresh(): Promise<RefreshTokenResponse | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  const [storedOrgId, storedOrgSlug] = await Promise.all([getStoredOrgId(), getStoredOrgSlug()]);

  try {
    // Asking by slug keeps this device in its org: without one the server falls back to the
    // session's last org, which a refused switch clears.
    const response = await client.refreshToken({
      refreshToken,
      organizationSlug: storedOrgSlug || undefined,
    });
    setAccessToken(response.accessToken);
    setAssetCookie(response.assetCookie);
    await setRefreshToken(response.refreshToken);
    if (response.organizationId) {
      await setStoredOrgId(response.organizationId, response.organizationSlug);
    } else if (storedOrgId) {
      // The grant is gone (membership removed, org suspended or deleted) but the session is not.
      await clearStoredOrgId();
      emitOrganizationLost();
    }
    return response;
  } catch (err) {
    // Only a definitive rejection ends the session; a network blip while
    // offline must not log the user out.
    if (isAuthRejection(err)) {
      await clearAuthStorage();
      emitSessionExpired();
      return null;
    }
    throw err;
  }
}
