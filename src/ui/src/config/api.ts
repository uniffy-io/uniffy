import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { withAuthLock } from "@/features/auth/authLock";
import {
  AUTH_STORAGE_KEY,
  readStoredAuth,
  writeStoredAuth,
} from "@/features/auth/store/credentialStorage";
import { env } from "@/config/env";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { RefreshTokenResponse } from "@uniffy/proto/auth/v1/auth_pb";
import { getStoreRef } from "@/app/storeRef";
import {
  createSetCredentialsAction,
  createStartRehydratingAction,
  createRehydrateCompleteAction,
  createRehydrateFailedAction,
  createLogoutAction,
  resetOrganizationScope,
} from "@/features/auth/store/authActions";
import {
  clearLastOrganizationSlug,
  readLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";
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

/** Fired when a refresh comes back without the organization this tab held; the session stays signed in. */
export const ORGANIZATION_LOST_EVENT = "uniffy:auth:org-lost";

function getAuthState() {
  const stored = readStoredAuth();
  return {
    accessToken: memoryAccessToken,
    refreshToken: stored?.refreshToken ?? null,
    user: stored?.user ?? null,
    currentOrganizationSlug: stored?.currentOrganizationSlug ?? null,
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

/** The response is the whole truth about this tab's org: no org back means the grant is gone. */
function updateAuthState(response: RefreshTokenResponse, requestedSlug: string | undefined): void {
  setMemoryAccessToken(response.accessToken);

  const store = getStoreRef();
  if (!store) {
    console.warn("Store not initialized, cannot update auth state");
    return;
  }

  const auth = store.getState().auth;
  if (!auth?.user) return;
  const { user } = auth;

  // `||` not `??`: protobuf returns "" for unset strings, which ?? does not fall through.
  const organizationId = response.organizationId || undefined;
  const organizationLost = Boolean(auth.currentOrganizationId) && !organizationId;
  // The lost org's data goes first so nothing renders it under org-less credentials.
  if (organizationLost) store.dispatch(resetOrganizationScope());

  store.dispatch(
    createSetCredentialsAction({
      user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      organizationId,
      organizationSlug: response.organizationSlug || undefined,
      organizationRole: response.organizationRole || undefined,
      sessionId: response.sessionId,
      // Always pass the array (even empty) so a revoked domain-admin grant
      // clears on the next refresh instead of sticking until logout.
      domainAdminDomains: Array.from(response.domainAdminDomains),
    }),
  );

  // Another tab may have picked a different org since; only the refused slug is forgotten.
  if (!organizationId && requestedSlug && readLastOrganizationSlug(user.id) === requestedSlug) {
    clearLastOrganizationSlug(user.id);
  }
  if (organizationLost && typeof window !== "undefined") {
    window.dispatchEvent(new Event(ORGANIZATION_LOST_EVENT));
  }
}

async function clearAuthAndRedirect(): Promise<void> {
  // Best-effort server-side session kill so a stolen refresh / leaked sid
  // does not outlive the client cleanup. The Logout RPC tolerates absent
  // or expired tokens, so failure here is non-fatal - we still proceed
  // with local cleanup and the redirect.
  const local = getStoreRef()?.getState().auth;
  const stored = readStoredAuth();
  const refreshToken =
    stored?.user?.id === local?.user?.id && stored?.currentSessionId === local?.currentSessionId
      ? stored?.refreshToken
      : null;
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
    writeStoredAuth(null);
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

interface RefreshOptions {
  organizationSlug?: string | null;
}

// Singleton in-flight refresh so concurrent callers share one network round-trip.
let refreshPromise: Promise<RefreshTokenResponse | null> | null = null;

async function refreshSession({
  organizationSlug,
}: RefreshOptions): Promise<RefreshTokenResponse | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const initial = readStoredAuth();
  const local = getStoreRef()?.getState().auth;
  if (local?.user && initial?.user?.id !== local.user.id) return null;

  if (!initial?.refreshToken || !initial.user) {
    return null;
  }
  const userId = initial.user.id;

  refreshPromise = withAuthLock(async () => {
    const current = readStoredAuth();
    if (
      !current?.refreshToken ||
      current.user?.id !== initial.user?.id ||
      current.currentSessionId !== initial.currentSessionId
    )
      return null;
    // Read under the lock: an org switch that held it has already moved this tab.
    const requestedSlug =
      organizationSlug ||
      getStoreRef()?.getState().auth?.currentOrganizationSlug ||
      readLastOrganizationSlug(userId) ||
      undefined;
    try {
      // Transport without auth interceptor - would otherwise recurse on 401.
      const refreshTransport = createConnectTransport({
        baseUrl: env.apiBaseUrl,
        useBinaryFormat: true,
        defaultTimeoutMs: 10_000,
      });

      const client = createClient(AuthService, refreshTransport);
      // The slug picks the org to mint. A grant that is gone comes back with no
      // org and a live session; UNAUTHENTICATED only means the session is dead.
      const response = await client.refreshToken({
        refreshToken: current.refreshToken,
        organizationSlug: requestedSlug,
      });
      if (readStoredAuth()?.refreshToken !== current.refreshToken) return null;

      updateAuthState(response, requestedSlug);

      return response;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
        console.warn("Token refresh failed: authentication required");
        clearMemoryAccessToken();
        return null;
      }
      throw error;
    }
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

/** Each tab refreshes into its own org: the explicit slug, else the tab's, else the device's last one. */
async function refreshAccessToken(options: RefreshOptions = {}): Promise<string | null> {
  const response = await refreshSession(options);
  return response?.accessToken ?? null;
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
  const { refreshToken, user, currentOrganizationSlug: persistedOrgSlug } = getAuthState();

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

    // A fresh tab lands in the org this device used last.
    const response = await refreshSession({
      organizationSlug: readLastOrganizationSlug(user.id) ?? persistedOrgSlug,
    });

    if (response) {
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
          accessToken: response.accessToken,
          refreshToken: state.auth?.refreshToken || refreshToken,
          // The minted org wins over the persisted one; an org-less response stays org-less.
          organizationId: response.organizationId || undefined,
          organizationSlug: response.organizationSlug || undefined,
          organizationRole: response.organizationRole || undefined,
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
    clearMemoryAccessToken();
    throw error;
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

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_STORAGE_KEY) return;
    const stored = readStoredAuth();
    const store = getStoreRef();
    const current = store?.getState().auth;
    if (!store || !current?.user) return;
    // Another tab's org is its own choice; only a different user or session ends this one.
    if (
      stored?.user?.id === current.user.id &&
      stored.currentSessionId === current.currentSessionId
    ) {
      store.dispatch({ type: "auth/syncRefreshToken", payload: stored.refreshToken });
      return;
    }
    clearMemoryAccessToken();
    window.dispatchEvent(new Event("uniffy:auth:revoked"));
    store.dispatch({ ...createLogoutAction(), meta: { external: true } });
  });
}
