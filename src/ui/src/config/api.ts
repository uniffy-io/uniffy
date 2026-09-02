import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { env } from "@/config/env";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import { getStoreRef } from "@/app/storeRef";
import {
  createSetCredentialsAction,
  createStartRehydratingAction,
  createRehydrateCompleteAction,
  createRehydrateFailedAction,
  createLogoutAction,
} from "@/features/auth/store/authActions";
import { initStorageEncryption } from "@/shared/crypto/storageEncryption";

// Access token lives in memory only - never persisted, to reduce XSS surface.
let memoryAccessToken: string | null = null;

// Dedicated slot for the short-lived MFA enrollment-only token. Kept
// separate from ``memoryAccessToken`` so the service worker never sees
// it (only access tokens get broadcast) and so the auth interceptor's
// refresh logic never tries to refresh it. The slot is populated only
// during the mid-login MFA enrollment dance and cleared the moment the
// real access token arrives from ConfirmEnrollment.
let memoryEnrollmentToken: string | null = null;

function getAuthState(): {
  accessToken: string | null;
  refreshToken: string | null;
  user: unknown;
  currentOrganizationId: string | null;
  currentOrganizationSlug: string | null;
  currentOrganizationRole: string | null;
} {
  const accessToken = memoryAccessToken;

  let refreshToken: string | null = null;
  let user: unknown = null;
  let currentOrganizationId: string | null = null;
  let currentOrganizationSlug: string | null = null;
  let currentOrganizationRole: string | null = null;

  try {
    const persistedState = localStorage.getItem("persist:root");
    if (persistedState) {
      const rootState = JSON.parse(persistedState);
      const authState = JSON.parse(rootState.auth || "{}");
      refreshToken = authState.refreshToken || null;
      user = authState.user || null;
      currentOrganizationId = authState.currentOrganizationId || null;
      currentOrganizationSlug = authState.currentOrganizationSlug || null;
      currentOrganizationRole = authState.currentOrganizationRole || null;
    }
  } catch {
    // Ignore parse errors
  }

  return {
    accessToken,
    refreshToken,
    user,
    currentOrganizationId,
    currentOrganizationSlug,
    currentOrganizationRole,
  };
}

function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

function clearMemoryAccessToken(): void {
  memoryAccessToken = null;
}

function setEnrollmentToken(token: string | null): void {
  memoryEnrollmentToken = token;
}

function clearEnrollmentToken(): void {
  memoryEnrollmentToken = null;
}

function getEnrollmentToken(): string | null {
  return memoryEnrollmentToken;
}

function updateAuthState(
  accessToken: string,
  refreshToken: string,
  organizationId?: string,
  organizationSlug?: string,
  organizationRole?: string,
  sessionId?: string,
  domainAdminDomains?: number[],
): void {
  setMemoryAccessToken(accessToken);

  const store = getStoreRef();
  if (!store) {
    console.warn("Store not initialized, cannot update auth state");
    return;
  }

  const state = store.getState();
  const user = state.auth?.user;
  const currentOrgId = state.auth?.currentOrganizationId;
  const currentOrgSlug = state.auth?.currentOrganizationSlug;
  const currentOrgRole = state.auth?.currentOrganizationRole;

  if (user) {
    store.dispatch(
      createSetCredentialsAction({
        user,
        accessToken,
        refreshToken,
        // `||` not `??`: protobuf returns "" for unset strings, which ?? does not fall through.
        organizationId: organizationId || currentOrgId || undefined,
        organizationSlug: organizationSlug || currentOrgSlug || undefined,
        organizationRole: organizationRole || currentOrgRole || undefined,
        sessionId,
        domainAdminDomains,
      }),
    );
  }
}

async function clearAuthAndRedirect(): Promise<void> {
  // Best-effort server-side session kill so a stolen refresh / leaked sid
  // does not outlive the client cleanup. The Logout RPC tolerates absent
  // or expired tokens, so failure here is non-fatal - we still proceed
  // with local cleanup and the redirect.
  const { refreshToken } = getAuthState();
  if (refreshToken) {
    try {
      const transportNoAuth = createConnectTransport({
        baseUrl: env.apiBaseUrl,
        useBinaryFormat: true,
        defaultTimeoutMs: 5_000,
      });
      const client = createClient(AuthService, transportNoAuth);
      await client.logout({ refreshToken });
    } catch {
      // Server-side cleanup is best-effort; ignore.
    }
  }

  clearMemoryAccessToken();

  // Tell the realtime multiplexer (and any other auth-aware long-lived
  // worker) to disconnect cleanly BEFORE we navigate. Without this the
  // page redirect tears the WS down in mid-frame and we lose the chance
  // to send a clean close frame.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("uniffy:auth:revoked"));
  }

  const store = getStoreRef();
  if (store) {
    store.dispatch(createLogoutAction());
  } else {
    localStorage.removeItem("persist:root");
  }
  window.location.href = "/auth";
}

function decodeJwtPayload(token: string): { exp?: number; iat?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function isTokenExpiring(token: string, bufferSeconds = 60): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + bufferSeconds;
}

// Singleton in-flight refresh so concurrent callers share one network round-trip.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const { refreshToken, user } = getAuthState();

  if (!refreshToken || !user) {
    return null;
  }

  refreshPromise = (async () => {
    try {
      // Transport without auth interceptor - would otherwise recurse on 401.
      const refreshTransport = createConnectTransport({
        baseUrl: env.apiBaseUrl,
        useBinaryFormat: true,
        defaultTimeoutMs: 10_000,
      });

      const client = createClient(AuthService, refreshTransport);
      // Refresh stays in whichever org the session is bound to server-side;
      // org switches go through AuthService.SwitchOrganization, not a slug here.
      const response = await client.refreshToken({ refreshToken });

      setMemoryAccessToken(response.accessToken);

      updateAuthState(
        response.accessToken,
        response.refreshToken,
        response.organizationId,
        response.organizationSlug,
        response.organizationRole,
        response.sessionId,
        // Always pass the array (even empty) so a revoked domain-admin grant
        // clears on the next refresh instead of sticking until logout.
        Array.from(response.domainAdminDomains),
      );

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("uniffy:auth:refreshed"));
      }

      return response.accessToken;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
        console.warn("Token refresh failed: authentication required");
      } else {
        console.error("Token refresh failed:", error);
      }
      clearMemoryAccessToken();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** Fetch cache key seed and seed client-side storage encryption. Called once per session. */
async function initStorageEncryptionFromApi(userId: string): Promise<void> {
  try {
    const client = createClient(AuthService, transport);
    const response = await client.getCacheKeySeed({});
    if (response.cacheKeySeed.length > 0) {
      await initStorageEncryption(new Uint8Array(response.cacheKeySeed), userId);
    }
  } catch (err) {
    console.warn("Failed to fetch cache key seed:", err);
  }
}

/** Recover an access token after redux-persist boots; also revalidates the user is still active. */
export async function rehydrateAuth(): Promise<boolean> {
  const {
    refreshToken,
    user,
    currentOrganizationId: persistedOrgId,
    currentOrganizationSlug: persistedOrgSlug,
    currentOrganizationRole: persistedOrgRole,
  } = getAuthState();

  if (!refreshToken || !user) {
    return false;
  }

  if (memoryAccessToken && !isTokenExpiring(memoryAccessToken)) {
    return true;
  }

  const store = getStoreRef();
  if (!store) {
    console.error("Auth rehydration failed: store not initialized");
    return false;
  }

  try {
    store.dispatch(createStartRehydratingAction());

    const newToken = await refreshAccessToken();

    if (newToken) {
      const state = store.getState();
      const persistedUser = user as {
        id: string;
        email: string;
        username: string;
        fullName: string;
        isActive: boolean;
        isSystemAdmin: boolean;
        emailVerified: boolean;
        accentColor?: string;
        fontFamily?: string;
        avatarUrl?: string;
        hasAvatar?: boolean;
      };

      store.dispatch(
        createRehydrateCompleteAction({
          user: {
            ...persistedUser,
            hasAvatar: persistedUser.hasAvatar ?? Boolean(persistedUser.avatarUrl),
          },
          accessToken: newToken,
          refreshToken: state.auth?.refreshToken || refreshToken,
          organizationId: state.auth?.currentOrganizationId || persistedOrgId || undefined,
          organizationSlug: state.auth?.currentOrganizationSlug || persistedOrgSlug || undefined,
          organizationRole: state.auth?.currentOrganizationRole || persistedOrgRole || undefined,
          sessionId: state.auth?.currentSessionId || undefined,
        }),
      );

      initStorageEncryptionFromApi(persistedUser.id).catch((err) => {
        console.warn("Storage encryption init failed:", err);
      });

      return true;
    } else {
      store.dispatch(createRehydrateFailedAction());
      return false;
    }
  } catch (error) {
    console.error("Auth rehydration failed:", error);
    clearMemoryAccessToken();
    store.dispatch(createRehydrateFailedAction());
    return false;
  }
}

const authInterceptor: Interceptor = (next) => async (req) => {
  // Refresh calls would recurse through this interceptor.
  const isRefreshRequest = req.url.includes("RefreshToken");

  if (!isRefreshRequest) {
    let { accessToken } = getAuthState();

    if (accessToken && isTokenExpiring(accessToken)) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        accessToken = newToken;
      } else {
        await clearAuthAndRedirect();
        throw new ConnectError("Session expired", Code.Unauthenticated);
      }
    }

    if (accessToken) {
      req.header.set("Authorization", `Bearer ${accessToken}`);
    } else if (memoryEnrollmentToken) {
      // Mid-login MFA enrollment: no access token exists yet, only the
      // short-lived enrollment-only token. Attach it without going
      // through the refresh path - the enrollment token is not
      // refreshable and the backend's strict ``type=access`` decoder
      // would reject any attempt to use it as one.
      req.header.set("Authorization", `Bearer ${memoryEnrollmentToken}`);
    }
  }

  try {
    return await next(req);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated && !isRefreshRequest) {
      // Skip the refresh+retry dance when we are riding on an enrollment
      // token - refresh would fail (no session yet) and bounce the user
      // off the enrollment page they are in the middle of.
      if (!memoryEnrollmentToken) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          req.header.set("Authorization", `Bearer ${newToken}`);
          return await next(req);
        }

        await clearAuthAndRedirect();
      }
    }

    throw error;
  }
};

export const transport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  interceptors: [authInterceptor],
  useBinaryFormat: true,
});

/** Unary-only transport. Connect's `defaultTimeoutMs` covers the whole call, so streaming RPCs must use `transport`. */
export const unaryTransport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  interceptors: [authInterceptor],
  useBinaryFormat: true,
  defaultTimeoutMs: 10_000,
});

/** Unary transport for pre-authentication RPCs whose 401 responses belong to the form. */
export const publicUnaryTransport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  useBinaryFormat: true,
  defaultTimeoutMs: 10_000,
});

export { setMemoryAccessToken };
export { clearMemoryAccessToken };
export { setEnrollmentToken };
export { clearEnrollmentToken };
export { getEnrollmentToken };

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export { refreshAccessToken };
export { initStorageEncryptionFromApi };
