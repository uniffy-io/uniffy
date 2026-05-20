/**
 * API Configuration
 *
 * Centralized ConnectRPC transport creation and configuration.
 * Use the exported transport instance for all API calls.
 *
 * Security features:
 * - Access tokens stored in memory only (not localStorage)
 * - Automatic token refresh with user verification
 * - Handles token revocation gracefully
 */

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

// In-memory access token storage (security: not persisted to localStorage)
let memoryAccessToken: string | null = null;

/**
 * Get auth state from Redux store (memory) and localStorage (refresh token only).
 * Access token is stored in memory only for security.
 */
function getAuthState(): {
  accessToken: string | null;
  refreshToken: string | null;
  user: unknown;
  currentOrganizationId: string | null;
  currentOrganizationSlug: string | null;
  currentOrganizationRole: string | null;
} {
  // Access token from memory
  const accessToken = memoryAccessToken;

  // Refresh token, user, org ID, slug, and role from localStorage (via redux-persist)
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

/**
 * Set access token in memory (not localStorage).
 * Also syncs with the Service Worker for media streaming.
 */
function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
  // Sync with Service Worker for media streaming
  if (token) {
    updateWorkerAuthToken(token);
  }
}

/**
 * Clear in-memory access token.
 * Also clears from the Service Worker.
 */
function clearMemoryAccessToken(): void {
  memoryAccessToken = null;
  // Clear from Service Worker
  clearWorkerAuthToken();
}

/**
 * Update auth state in memory and Redux store.
 * Access token goes to memory, refresh token to Redux (persisted).
 * Preserves current organizationId and organizationRole if not provided.
 */
function updateAuthState(
  accessToken: string,
  refreshToken: string,
  organizationId?: string,
  organizationRole?: string,
  sessionId?: string,
  domainAdminDomains?: number[],
): void {
  // Store access token in memory only (security)
  setMemoryAccessToken(accessToken);

  // Use storeRef to avoid circular dependency
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
      accessToken, // This will be stripped by transform before persistence
      refreshToken,
      // Preserve existing org ID and role if not provided (important for token refresh).
      // Use || instead of ?? because protobuf returns "" (empty string) for unset
      // string fields, and ?? does not fall back on empty strings.
      organizationId: organizationId || currentOrgId || undefined,
      organizationRole: organizationRole || currentOrgRole || undefined,
      sessionId,
      domainAdminDomains,
    }));
  }
}

/**
 * Clear auth state and redirect to login.
 * Clears both memory token and Redux state.
 */
function clearAuthAndRedirect(): void {
  // Clear memory token first
  clearMemoryAccessToken();

  // Use storeRef to avoid circular dependency
  const store = getStoreRef();
  if (store) {
    store.dispatch(createLogoutAction());
  } else {
    // Fallback: clear localStorage directly
    localStorage.removeItem('persist:root');
  }
  window.location.href = '/auth';
}

/**
 * Decode JWT payload without verifying signature (for client-side expiry check).
 */
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

/**
 * Check if token is expired or will expire within the buffer time.
 * @param token JWT token string
 * @param bufferSeconds Seconds before actual expiry to consider token as expiring (default: 60)
 */
function isTokenExpiring(token: string, bufferSeconds = 60): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + bufferSeconds;
}

// Prevent concurrent refresh attempts
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token or null if refresh failed.
 *
 * Security: This is where the backend verifies user is still active
 * and token version is valid. If user was deactivated or token revoked,
 * this will fail and user will be logged out.
 *
 * All refresh failures are treated equally - we don't inspect error messages
 * as that would be a security anti-pattern (messages can be manipulated).
 * The backend returns UNAUTHENTICATED for any auth failure, and we respond
 * by clearing credentials and requiring re-login.
 */
async function refreshAccessToken(): Promise<string | null> {
  // If already refreshing, wait for that to complete
  if (refreshPromise) {
    return refreshPromise;
  }

  const { refreshToken, user, currentOrganizationSlug } = getAuthState();

  if (!refreshToken || !user) {
    return null;
  }

  refreshPromise = (async () => {
    try {
      // Create a transport without auth interceptor to avoid infinite loop
      const refreshTransport = createConnectTransport({
        baseUrl: env.apiBaseUrl,
        useBinaryFormat: true,
        defaultTimeoutMs: 10_000,
      });

      const client = createClient(AuthService, refreshTransport);
      // Pass the persisted org slug so the refreshed access token
      // keeps its ``org_id`` claim - handlers enforcing token org
      // parity (e.g. realtime WS upgrade) require it.
      const response = await client.refreshToken({
        refreshToken,
        ...(currentOrganizationSlug ? { organizationSlug: currentOrganizationSlug } : {}),
      });

      // Store access token in memory
      setMemoryAccessToken(response.accessToken);

      // Update Redux state (including organization role and session ID from response)
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
      // All refresh failures result in logout - we don't differentiate by error message
      // as that would be a security anti-pattern. The backend uses proper error codes.
      if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
        console.warn('Token refresh failed: authentication required');
      } else {
        console.error('Token refresh failed:', error);
      }
      // Clear memory token on any refresh failure
      clearMemoryAccessToken();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Fetch cache key seed and initialize client-side storage encryption.
 * Called once per session after successful auth rehydration or login.
 */
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

/**
 * Rehydrate authentication on app startup.
 *
 * Called after redux-persist rehydrates state. If we have a refresh token
 * but no access token (normal case after page reload), this gets a new
 * access token from the backend and fetches current user data.
 *
 * Security: This validates the user is still active on every app load.
 *
 * @returns true if successfully authenticated, false otherwise
 */
export async function rehydrateAuth(): Promise<boolean> {
  const {
    refreshToken,
    user,
    currentOrganizationId: persistedOrgId,
    currentOrganizationSlug: persistedOrgSlug,
    currentOrganizationRole: persistedOrgRole,
  } = getAuthState();

  // No refresh token = not logged in
  if (!refreshToken || !user) {
    return false;
  }

  // Already have access token in memory (shouldn't happen after reload, but handle it)
  if (memoryAccessToken && !isTokenExpiring(memoryAccessToken)) {
    return true;
  }

  // Notify Redux we're rehydrating
  const store = getStoreRef();
  if (!store) {
    console.error('Auth rehydration failed: store not initialized');
    return false;
  }

  try {
    store.dispatch(createStartRehydratingAction());

    // Attempt to refresh
    const newToken = await refreshAccessToken();

    if (newToken) {
      // Get updated state after refresh
      const state = store.getState();
      // User data is already persisted in localStorage via redux-persist
      // (only accessToken is excluded from persistence for security)
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

      // Initialize client-side storage encryption (non-blocking)
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

/**
 * Auth interceptor that adds JWT token to requests and handles auth errors.
 *
 * Features:
 * - Automatically includes the access token in the Authorization header
 * - Proactively refreshes tokens that are about to expire (within 60s)
 * - Retries failed requests after successful token refresh
 * - Redirects to login page when refresh fails
 */
const authInterceptor: Interceptor = (next) => async (req) => {
  // Skip auth for refresh token requests to avoid infinite loop
  const isRefreshRequest = req.url.includes('RefreshToken');

  if (!isRefreshRequest) {
    let { accessToken } = getAuthState();

    // Check if token exists and is expiring soon
    if (accessToken && isTokenExpiring(accessToken)) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        accessToken = newToken;
      } else {
        // Refresh failed, redirect to login
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
    // Handle UNAUTHENTICATED errors (e.g., token expired between check and request)
    if (error instanceof ConnectError && error.code === Code.Unauthenticated && !isRefreshRequest) {
      // Try to refresh and retry once
      const newToken = await refreshAccessToken();
      if (newToken) {
        req.header.set('Authorization', `Bearer ${newToken}`);
        return await next(req);
      }

      // Refresh failed, redirect to login
      await clearAuthAndRedirect();
    }

    throw error;
  }
};

/**
 * Shared ConnectRPC transport instance.
 * 
 * This transport is configured with the base API URL from environment config
 * and includes an interceptor for handling authentication errors.
 * 
 * When a token is about to expire (within 60 seconds), the interceptor:
 * - Automatically refreshes the token using the refresh token
 * - Updates the stored credentials with new tokens
 *
 * When refresh fails or the user is not authenticated:
 * - Clears stored credentials
 * - Redirects the user to the login page
 * 
 * All API clients should use this transport to ensure consistent configuration.
 * 
 * @example
 * ```ts
 * import { createClient } from "@connectrpc/connect";
 * import { transport } from "@/config/api";
 * import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
 * 
 * const client = createClient(AuthService, transport);
 * ```
 */
export const transport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  interceptors: [authInterceptor],
  useBinaryFormat: true,
});

/**
 * Unary-only transport with a 10s default timeout.
 *
 * Connect's `defaultTimeoutMs` applies to the whole call lifetime, so it cannot
 * be used with streaming RPCs (chat events, notifications, runtime stream,
 * file download/range). Streaming services must use `transport` above.
 */
export const unaryTransport = createConnectTransport({
  baseUrl: env.apiBaseUrl,
  interceptors: [authInterceptor],
  useBinaryFormat: true,
  defaultTimeoutMs: 10_000,
});

/**
 * Set access token after login.
 * Must be called when user logs in to store token in memory.
 */
export { setMemoryAccessToken };

/**
 * Clear access token on logout.
 * Must be called when user logs out to remove token from memory.
 */
export { clearMemoryAccessToken };

/**
 * Get current access token (for passing to workers).
 */
export function getAccessToken(): string | null {
    return memoryAccessToken;
}

/**
 * Refresh access token and return the new token.
 * Used by workers when they receive 401 errors.
 */
export { refreshAccessToken };

/**
 * Initialize storage encryption after login.
 * Exported for use by login flow.
 */
export { initStorageEncryptionFromApi };
