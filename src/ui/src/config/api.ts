import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor } from "@connectrpc/connect";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
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
  readLastOrganization,
  readLastOrganizationSlug,
  writeLastOrganization,
} from "@/features/auth/store/lastOrganizationStorage";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";
import { clearStoredFilesFilters } from "@/features/files/store/filesFilterStorage";
import { clearRecentItemsForUser } from "@/features/search/utils/recentItems";
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

/** Detail of `ORGANIZATION_LOST_EVENT`. The id is absent when the tab knew the organization by slug only. */
export interface OrganizationLostDetail {
  organizationId?: string;
}

// A lost grant the shell has not handled yet. A reload notices one before any listener mounts.
let pendingOrganizationLost: { userId: string; detail: OrganizationLostDetail } | null = null;

/** Hands over, once, the lost grant of this user that no listener has handled yet. */
export function takePendingOrganizationLost(userId: string): OrganizationLostDetail | null {
  const pending = pendingOrganizationLost;
  pendingOrganizationLost = null;
  return pending?.userId === userId ? pending.detail : null;
}

function announceOrganizationLost(userId: string, organizationId: string | undefined): void {
  pendingOrganizationLost = { userId, detail: { organizationId } };
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OrganizationLostDetail>(ORGANIZATION_LOST_EVENT, {
      detail: { organizationId },
    }),
  );
}

/** The organization a refresh asks for. Ids survive a slug rename; the slug is a fallback hint. */
interface OrganizationRef {
  id?: string;
  slug?: string;
}

function getAuthState() {
  const stored = readStoredAuth();
  return {
    accessToken: memoryAccessToken,
    refreshToken: stored?.refreshToken ?? null,
    user: stored?.user ?? null,
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

/**
 * The response is the whole truth about this tab's org: no org back for the one the tab `held`
 * means the grant is gone.
 */
function updateAuthState(
  response: RefreshTokenResponse,
  requested: OrganizationRef,
  held: boolean,
): void {
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
  const organizationSlug = response.organizationSlug || undefined;
  const organizationLost = held && !organizationId;
  // The lost org's data goes first so nothing renders it under org-less credentials.
  if (organizationLost) store.dispatch(resetOrganizationScope());

  store.dispatch(
    createSetCredentialsAction({
      user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      organizationId,
      organizationSlug,
      organizationRole: response.organizationRole || undefined,
      sessionId: response.sessionId,
      // Always pass the array (even empty) so a revoked domain-admin grant
      // clears on the next refresh instead of sticking until logout.
      domainAdminDomains: Array.from(response.domainAdminDomains),
    }),
  );

  // Another tab may have picked a different org since; only the requested slug is forgotten or,
  // after a rename, moved to the current one.
  if (requested.slug && readLastOrganizationSlug(user.id) === requested.slug) {
    if (!organizationId) clearLastOrganizationSlug(user.id);
    else if (organizationSlug && organizationSlug !== requested.slug)
      writeLastOrganization(user.id, { id: organizationId, slug: organizationSlug });
  }
  if (organizationLost) announceOrganizationLost(user.id, requested.id);
}

// Bounds the device cleanup of an ended session, so a blocked database cannot hold the redirect.
const SESSION_CLEANUP_TIMEOUT_MS = 2_000;

/**
 * An ended session's device stores go with it. The storage key and pending realtime rows stay:
 * the same user's next sign-in drains those edits, and another account's sign-in wipes them.
 */
async function clearEndedSessionStores(userId: string): Promise<void> {
  clearRecentItemsForUser(userId);
  clearStoredFilesFilters(userId);
  // Imported on demand: the upload engine imports this module for its transport, and both
  // register their databases with storage encryption when they load.
  const uploads = import("@/features/files/upload").then(({ uploadService }) =>
    uploadService.purgeUser(userId),
  );
  const notes = import("@/features/notes/utils/notesCache").then(({ clearAllCache }) =>
    clearAllCache(),
  );
  const cleanup = Promise.allSettled([notes, uploads]);
  await Promise.race([
    cleanup,
    new Promise((resolve) => setTimeout(resolve, SESSION_CLEANUP_TIMEOUT_MS)),
  ]);
}

async function clearAuthAndRedirect(): Promise<void> {
  // Best-effort server-side session kill so a stolen refresh / leaked sid
  // does not outlive the client cleanup. The Logout RPC tolerates absent
  // or expired tokens, so failure here is non-fatal - we still proceed
  // with local cleanup and the redirect.
  const local = getStoreRef()?.getState().auth;
  const stored = readStoredAuth();
  const sameSession =
    stored?.user?.id === local?.user?.id && stored?.currentSessionId === local?.currentSessionId;
  const refreshToken = sameSession ? stored?.refreshToken : null;
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

  // Skipped when a newer sign-in in another tab owns the device stores now.
  const userId = local?.user?.id;
  if (userId && (!stored?.user || sameSession)) await clearEndedSessionStores(userId);

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
  /** The organization this tab is in when Redux does not know it yet, such as on reload. */
  organization?: OrganizationRef;
}

// Singleton in-flight refresh so concurrent callers share one network round-trip.
let refreshPromise: Promise<RefreshTokenResponse | null> | null = null;

async function refreshSession({
  organization,
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
    const tab = getStoreRef()?.getState().auth;
    const held: OrganizationRef | undefined =
      organization ??
      (tab?.currentOrganizationId
        ? {
            id: tab.currentOrganizationId,
            slug: tab.currentOrganizationSlug || undefined,
          }
        : undefined);
    // A tab in no organization asks for the device's last one, which it never held.
    const last = held ? null : readLastOrganization(userId);
    const requested: OrganizationRef = held ?? { id: last?.id, slug: last?.slug };
    try {
      // Transport without auth interceptor - would otherwise recurse on 401.
      const refreshTransport = createConnectTransport({
        baseUrl: env.apiBaseUrl,
        useBinaryFormat: true,
        defaultTimeoutMs: 10_000,
      });

      const client = createClient(AuthService, refreshTransport);
      // The id picks the org to mint and wins over the slug. A grant that is gone comes back
      // with no org and a live session; UNAUTHENTICATED only means the session is dead.
      const response = await client.refreshToken({
        refreshToken: current.refreshToken,
        organizationId: requested.id,
        organizationSlug: requested.slug,
      });
      if (readStoredAuth()?.refreshToken !== current.refreshToken) return null;

      updateAuthState(response, requested, held !== undefined);

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

/** Each tab refreshes into its own org: the explicit one, else the tab's, else the device's last one. */
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

/** Where a reload lands: this tab's org, else the device's last one for a fresh tab, else the persisted one. */
function reloadOrganization(
  userId: string,
  persisted: { currentOrganizationId: string | null; currentOrganizationSlug: string | null },
): OrganizationRef | undefined {
  const tab = readTabOrganization(userId);
  if (tab) return { id: tab.id, slug: tab.slug || undefined };
  const last = readLastOrganization(userId);
  if (last) return { id: last.id, slug: last.slug };
  if (persisted.currentOrganizationId || persisted.currentOrganizationSlug) {
    return {
      id: persisted.currentOrganizationId || undefined,
      slug: persisted.currentOrganizationSlug || undefined,
    };
  }
  return undefined;
}

/** Recover an access token after redux-persist boots; also revalidates the user is still active. */
export async function rehydrateAuth(): Promise<boolean> {
  const { refreshToken, user } = getAuthState();

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
    const persisted = store.getState().auth;
    store.dispatch(createStartRehydratingAction());

    const response = await refreshSession({
      organization: reloadOrganization(user.id, persisted),
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
      // The record is gone only when no newer sign-in or rotation owns it, so the dead session's
      // device stores go with it, as on an expiry mid-session.
      if (!readStoredAuth()?.user) await clearEndedSessionStores(user.id);
      return false;
    }
  } catch (error) {
    clearMemoryAccessToken();
    throw error;
  }
}

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

/** The typed reason the server attached to a refusal, such as `sign_in_required`, or null. */
export function decodeErrorReason(err: unknown): string | null {
  if (!(err instanceof ConnectError)) return null;
  for (const detail of err.details) {
    if (!("type" in detail) || detail.type !== ERROR_INFO_TYPE) continue;
    const info = readErrorInfo(detail.value);
    if (info?.domain === ERROR_INFO_DOMAIN && info.reason) return info.reason;
  }
  return null;
}

/** The server refused because the caller is no active member of the organization. Only a hint:
 * the refresh it triggers decides whether the grant is gone. */
export function decodeMembershipRequired(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    err.code === Code.PermissionDenied &&
    decodeErrorReason(err) === MEMBERSHIP_REQUIRED_REASON
  );
}

// One removal reaches the tab as many refusals, every RPC in flight at once. They share one
// refresh per refused access token; a refusal of the refreshed token asks once more.
let membershipCheckedFor: string | null = null;

function refreshAfterMembershipDenial(deniedToken: string): void {
  if (deniedToken === membershipCheckedFor) return;
  membershipCheckedFor = deniedToken;
  void refreshAccessToken().catch(() => null);
}

const authInterceptor: Interceptor = (next) => async (req) => {
  // Refresh calls would recurse through this interceptor.
  const isRefreshRequest = req.url.includes("RefreshToken");
  let sentToken: string | null = null;

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
      sentToken = accessToken;
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
    // A removal from the organization would otherwise show only at the next expiry refresh. The
    // refusal still reaches the caller; the refresh resets the tab when the grant is gone.
    if (sentToken && decodeMembershipRequired(error)) refreshAfterMembershipDenial(sentToken);
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
