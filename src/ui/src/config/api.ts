import { createConnectTransport } from '@connectrpc/connect-web';
import type { Interceptor } from '@connectrpc/connect';
import { ConnectError, Code, createClient } from '@connectrpc/connect';
import { env } from '@/config/env';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { getStoreRef } from '@/app/storeRef';
import {
  createSetCredentialsAction,
  createStartRehydratingAction,
  createRehydrateCompleteAction,
  createRehydrateFailedAction,
  createLogoutAction,
} from '@/features/auth/store/authActions';
import { updateWorkerAuthToken, clearWorkerAuthToken } from '@/workers/registerMediaWorker';
import { initStorageEncryption } from '@/shared/crypto/storageEncryption';

// Access token lives in memory only - never persisted, to reduce XSS surface.
let memoryAccessToken: string | null = null;

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
    const persistedState = localStorage.getItem('persist:root');
    if (persistedState) {
      const rootState = JSON.parse(persistedState);
      const authState = JSON.parse(rootState.auth || '{}');
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
  if (token) {
    updateWorkerAuthToken(token);
  }
}

function clearMemoryAccessToken(): void {
  memoryAccessToken = null;
  clearWorkerAuthToken();
}

function updateAuthState(
  accessToken: string,
  refreshToken: string,
  organizationId?: string,
  organizationRole?: string,
  sessionId?: string,
  domainAdminDomains?: number[],
): void {
  setMemoryAccessToken(accessToken);

  const store = getStoreRef();
  if (!store) {
    console.warn('Store not initialized, cannot update auth state');
    return;
  }

  const state = store.getState();
  const user = state.auth?.user;
  const currentOrgId = state.auth?.currentOrganizationId;
  const currentOrgRole = state.auth?.currentOrganizationRole;

  if (user) {
    store.dispatch(createSetCredentialsAction({
      user,
      accessToken,
      refreshToken,
      // `||` not `??`: protobuf returns "" for unset strings, which ?? does not fall through.
      organizationId: organizationId || currentOrgId || undefined,
      organizationRole: organizationRole || currentOrgRole || undefined,
      sessionId,
      domainAdminDomains,
    }));
  }
}

function clearAuthAndRedirect(): void {
  clearMemoryAccessToken();

  const store = getStoreRef();
  if (store) {
    store.dispatch(createLogoutAction());
  } else {
    localStorage.removeItem('persist:root');
  }
  window.location.href = '/auth';
}

function decodeJwtPayload(token: string): { exp?: number; iat?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
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

  const { refreshToken, user, currentOrganizationSlug } = getAuthState();

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
      // Pass org slug so the refreshed access token keeps its `org_id` claim;
      // handlers enforcing token-org parity (e.g. realtime WS upgrade) require it.
      const response = await client.refreshToken({
        refreshToken,
        ...(currentOrganizationSlug ? { organizationSlug: currentOrganizationSlug } : {}),
      });

      setMemoryAccessToken(response.accessToken);

      updateAuthState(
        response.accessToken,
        response.refreshToken,
        response.organizationId,
        response.organizationRole,
        response.sessionId,
        response.domainAdminDomains.length > 0 ? Array.from(response.domainAdminDomains) : undefined,
      );

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('uniffy:auth:refreshed'));
      }

      return response.accessToken;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
        console.warn('Token refresh failed: authentication required');
      } else {
        console.error('Token refresh failed:', error);
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
    console.warn('Failed to fetch cache key seed:', err);
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
    console.error('Auth rehydration failed: store not initialized');
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

      store.dispatch(createRehydrateCompleteAction({
        user: { ...persistedUser, hasAvatar: persistedUser.hasAvatar ?? Boolean(persistedUser.avatarUrl) },
        accessToken: newToken,
        refreshToken: state.auth?.refreshToken || refreshToken,
        organizationId: state.auth?.currentOrganizationId || persistedOrgId || undefined,
        organizationSlug: state.auth?.currentOrganizationSlug || persistedOrgSlug || undefined,
        organizationRole: state.auth?.currentOrganizationRole || persistedOrgRole || undefined,
        sessionId: state.auth?.currentSessionId || undefined,
      }));

      initStorageEncryptionFromApi(persistedUser.id).catch((err) => {
        console.warn('Storage encryption init failed:', err);
      });

      return true;
    } else {
      store.dispatch(createRehydrateFailedAction());
      return false;
    }
  } catch (error) {
    console.error('Auth rehydration failed:', error);
    clearMemoryAccessToken();
    store.dispatch(createRehydrateFailedAction());
    return false;
  }
}

const authInterceptor: Interceptor = (next) => async (req) => {
  // Refresh calls would recurse through this interceptor.
  const isRefreshRequest = req.url.includes('RefreshToken');

  if (!isRefreshRequest) {
    let { accessToken } = getAuthState();

    if (accessToken && isTokenExpiring(accessToken)) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        accessToken = newToken;
      } else {
        await clearAuthAndRedirect();
        throw new ConnectError('Session expired', Code.Unauthenticated);
      }
    }

    if (accessToken) {
      req.header.set('Authorization', `Bearer ${accessToken}`);
    }
  }

  try {
    return await next(req);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated && !isRefreshRequest) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        req.header.set('Authorization', `Bearer ${newToken}`);
        return await next(req);
      }

      await clearAuthAndRedirect();
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

export { setMemoryAccessToken };
export { clearMemoryAccessToken };

export function getAccessToken(): string | null {
    return memoryAccessToken;
}

export { refreshAccessToken };
export { initStorageEncryptionFromApi };
