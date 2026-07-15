import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { RefreshTokenResponse } from "@uniffy/proto/auth/v1/auth_pb";
import { publicTransport } from "@core/api/publicTransport";
import {
  clearAuthStorage,
  getRefreshToken,
  setAccessToken,
  setAssetCookie,
  setRefreshToken,
  setStoredOrgId,
} from "@core/auth/auth";
import { emitSessionExpired } from "@core/auth/sessionEvents";

const client = createClient(AuthService, publicTransport);

let inFlight: Promise<RefreshTokenResponse | null> | null = null;

// Single-flight: the server rotates the refresh token on every call, so
// concurrent 401s and proactive expiry checks must share one round-trip
// instead of racing the rotated token against itself.
export function refreshSession(): Promise<RefreshTokenResponse | null> {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

function isAuthRejection(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    (err.code === Code.Unauthenticated || err.code === Code.PermissionDenied)
  );
}

async function doRefresh(): Promise<RefreshTokenResponse | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await client.refreshToken({ refreshToken });
    setAccessToken(response.accessToken);
    setAssetCookie(response.assetCookie);
    await setRefreshToken(response.refreshToken);
    if (response.organizationId) {
      await setStoredOrgId(response.organizationId);
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
