import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { AppState } from "react-native";
import { Image } from "expo-image";
import type { GetCurrentUserResponse } from "@uniffy/proto/auth/v1/auth_pb";
import type { CurrentUser } from "@core/types";
import { queryClient } from "@core/api/queryClient";
import {
  getAccessToken,
  setAccessToken,
  setAssetCookie,
  setRefreshToken,
  getRefreshToken,
  setStoredOrgId,
  clearStoredOrgId,
  clearAuthStorage,
} from "@core/auth/auth";
import { authApi } from "@core/auth/authApi";
import { isTokenExpiring } from "@core/auth/jwt";
import { isAuthRejection, refreshSession, withRefreshLock } from "@core/auth/refresh";
import {
  onSessionExpired,
  onOrganizationLost,
  clearUserSessionData,
  emitAuthBoundary,
  listUnsyncedOrganizations,
} from "@core/auth/sessionEvents";
import { resetSessionScope } from "@core/auth/sessionScope";
import { hydrateServerUrl } from "@core/config/serverUrl";

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationSlug?: string;
  organizationRole?: string;
  domainAdminDomains?: readonly number[];
  assetCookie?: string;
};

interface AuthState {
  user: CurrentUser | null;
  organizationId: string | null;
  organizationRole: string | null;
  /** `common.v1.DomainType` values the user is a domain admin for. */
  domainAdminDomains: number[];
  isAuthenticated: boolean;
  isRehydrating: boolean;
}

type AuthAction =
  | {
      type: "SET_AUTHENTICATED";
      user: CurrentUser;
      organizationId: string | null;
      organizationRole: string | null;
      domainAdminDomains: number[];
    }
  | {
      type: "SET_ORGANIZATION";
      organizationId: string | null;
      organizationRole: string | null;
      domainAdminDomains: number[];
    }
  | { type: "SET_REHYDRATING"; value: boolean }
  | { type: "LOGOUT" };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "SET_AUTHENTICATED":
      return {
        ...state,
        user: action.user,
        organizationId: action.organizationId,
        organizationRole: action.organizationRole,
        domainAdminDomains: action.domainAdminDomains,
        isAuthenticated: true,
        isRehydrating: false,
      };
    case "SET_ORGANIZATION":
      // No org means no role in one: a lost grant takes its admin powers with it.
      return {
        ...state,
        organizationId: action.organizationId,
        organizationRole: action.organizationId ? action.organizationRole : null,
        domainAdminDomains: action.organizationId ? action.domainAdminDomains : [],
      };
    case "SET_REHYDRATING":
      return { ...state, isRehydrating: action.value };
    case "LOGOUT":
      return {
        user: null,
        organizationId: null,
        organizationRole: null,
        domainAdminDomains: [],
        isAuthenticated: false,
        isRehydrating: false,
      };
    default:
      return state;
  }
}

function toCurrentUser(response: GetCurrentUserResponse): CurrentUser {
  return {
    id: response.id,
    email: response.email,
    username: response.username,
    fullName: response.fullName ?? "",
    avatarUrl: response.avatarUrl ?? "",
    accentColor: response.accentColor ?? "",
    fontFamily: response.fontFamily ?? "",
    isActive: response.isActive,
    isSystemAdmin: response.isSystemAdmin,
    emailVerified: response.emailVerified,
  };
}

export type LoginResult =
  | { status: "ok" }
  | { status: "mfa"; challengeToken: string; methods: string[] }
  | { status: "enroll"; enrollmentToken: string };

/** `unsynced` names the organizations whose edits only this device holds. An empty list means
 * the check failed and could not tell which. */
export type LogoutResult =
  | { status: "signed_out" }
  | { status: "unsynced"; organizationIds: readonly string[] };

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (challengeToken: string, code: string, method: string) => Promise<void>;
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>;
  acceptInvitation: (
    token: string,
    username: string,
    password: string,
    fullName?: string,
  ) => Promise<LoginResult>;
  beginForcedEnrollment: (enrollmentToken: string) => void;
  completeEnrollment: (tokens: AuthTokens) => Promise<void>;
  /** Asks for the organization by id when the caller knows it, since a slug can be renamed. */
  selectOrganization: (slug: string, organizationId?: string) => Promise<void>;
  /** Resolves `unsynced` without signing out while edits only this device holds would be
   * deleted; callers confirm and retry with `discardUnsynced`. */
  logout: (options?: { discardUnsynced?: boolean }) => Promise<LogoutResult>;
  holdNavigation: boolean;
  setHoldNavigation: (v: boolean) => void;
  loginSplashVisible: boolean;
  setLoginSplashVisible: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REHYDRATE_RETRY_BASE_MS = 3000;
const REHYDRATE_RETRY_MAX_MS = 15000;

/** Cache subdirectory that holds downloaded files, as `<userId>/<organizationId>/<name>`. */
export const DOWNLOADS_CACHE_DIRECTORY = "downloads";

// A download lives only until its share or copy settles; this removes any a crash or a share
// still open left behind. A build without the native module never stored one.
function deleteDownloads(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy");
    if (!FileSystem.cacheDirectory) return;
    void FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${DOWNLOADS_CACHE_DIRECTORY}`, {
      idempotent: true,
    }).catch(() => {});
  } catch {
    // No module, no downloads.
  }
}

// Wiping caches on every auth boundary keeps one user's content (query data,
// decoded images and downloaded files on disk) from surviving into another session on the device.
function clearSessionCaches(): void {
  resetSessionScope();
  queryClient.clear();
  void Image.clearMemoryCache();
  void Image.clearDiskCache();
  deleteDownloads();
}

async function handleAuthResponse(
  response: AuthTokens,
  dispatch: React.Dispatch<AuthAction>,
): Promise<void> {
  clearSessionCaches();
  setAccessToken(response.accessToken);
  setAssetCookie(response.assetCookie ?? null);
  await setRefreshToken(response.refreshToken);

  if (response.organizationId) {
    await setStoredOrgId(response.organizationId, response.organizationSlug);
  } else {
    await clearStoredOrgId();
  }
  emitAuthBoundary(response.organizationId || null);

  const user = await authApi.getCurrentUser();

  dispatch({
    type: "SET_AUTHENTICATED",
    user: toCurrentUser(user),
    organizationId: response.organizationId ?? null,
    organizationRole: response.organizationRole ?? null,
    domainAdminDomains: [...(response.domainAdminDomains ?? [])],
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [holdNavigation, setHoldNavigation] = useState(false);
  const [loginSplashVisible, setLoginSplashVisible] = useState(false);
  const [state, dispatch] = useReducer(authReducer, {
    user: null,
    organizationId: null,
    organizationRole: null,
    domainAdminDomains: [],
    isAuthenticated: false,
    isRehydrating: true,
  });

  // Rehydrate on mount: check for stored refresh token
  useEffect(() => {
    let cancelled = false;

    async function rehydrate() {
      let retryDelayMs = REHYDRATE_RETRY_BASE_MS;
      while (!cancelled) {
        try {
          // Load the persisted server before any request so refreshSession and
          // the first queries hit the deployment the user last signed in to.
          await hydrateServerUrl();

          const refreshToken = await getRefreshToken();
          if (!refreshToken) {
            dispatch({ type: "SET_REHYDRATING", value: false });
            return;
          }

          const response = await refreshSession();

          if (cancelled) return;

          if (!response) {
            dispatch({ type: "LOGOUT" });
            return;
          }

          // The server's answer is the org this device is in. refreshSession already stored it,
          // or dropped a stored org the server no longer grants.
          const orgId = response.organizationId || null;

          const user = await authApi.getCurrentUser();

          if (cancelled) return;

          dispatch({
            type: "SET_AUTHENTICATED",
            user: toCurrentUser(user),
            organizationId: orgId,
            organizationRole: response.organizationRole || null,
            domainAdminDomains: [...response.domainAdminDomains],
          });
          return;
        } catch (err) {
          if (cancelled) return;
          if (isAuthRejection(err)) {
            dispatch({ type: "LOGOUT" });
            return;
          }
          // Offline cold start: the stored session is still valid, so keep
          // the splash and retry until the network gives a definitive answer
          // instead of dumping the user on the login screen.
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          retryDelayMs = Math.min(retryDelayMs * 2, REHYDRATE_RETRY_MAX_MS);
        }
      }
    }

    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // A rejected refresh anywhere (interceptor, image retry) ends the session:
  // wipe caches and let AuthGate route back to the login screen.
  useEffect(() => {
    return onSessionExpired(() => {
      clearSessionCaches();
      dispatch({ type: "LOGOUT" });
    });
  }, []);

  // A refresh that no longer grants this device's org keeps the session: drop that org's data
  // and let AuthGate route to the organization picker.
  useEffect(() => {
    return onOrganizationLost(() => {
      clearSessionCaches();
      dispatch({
        type: "SET_ORGANIZATION",
        organizationId: null,
        organizationRole: null,
        domainAdminDomains: [],
      });
      emitAuthBoundary(null);
    });
  }, []);

  // Returning to the foreground after a long background stay: refresh before
  // the first queries and images fire so they do not race an expired token.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      const token = getAccessToken();
      if (token && isTokenExpiring(token)) {
        void refreshSession().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const response = await authApi.login(email, password);
    switch (response.result.case) {
      case "authResult":
        await handleAuthResponse(response.result.value, dispatch);
        return { status: "ok" };
      case "mfaChallenge":
        return {
          status: "mfa",
          challengeToken: response.result.value.challengeToken,
          methods: response.result.value.methods,
        };
      case "enrollmentRequired":
        return {
          status: "enroll",
          enrollmentToken: response.result.value.enrollmentToken,
        };
      default:
        throw new Error("Unexpected login response");
    }
  }, []);

  const verifyMfa = useCallback(async (challengeToken: string, code: string, method: string) => {
    const response = await authApi.verifyMfa(challengeToken, code, method);
    await handleAuthResponse(response, dispatch);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string, fullName?: string) => {
      const response = await authApi.register(email, username, password, fullName);
      await handleAuthResponse(response, dispatch);
    },
    [],
  );

  const acceptInvitation = useCallback(
    async (
      token: string,
      username: string,
      password: string,
      fullName?: string,
    ): Promise<LoginResult> => {
      const response = await authApi.acceptInvitation(token, username, password, fullName);
      switch (response.result.case) {
        case "authResult":
          await handleAuthResponse(response.result.value, dispatch);
          return { status: "ok" };
        case "enrollmentRequired":
          return { status: "enroll", enrollmentToken: response.result.value.enrollmentToken };
        default:
          throw new Error("Unexpected invitation response");
      }
    },
    [],
  );

  // Forced MFA enrollment at login: the enrollment_token authorises only the
  // MfaService enrollment RPCs, so make it the active bearer until enrollment
  // completes and real session tokens arrive.
  const beginForcedEnrollment = useCallback((enrollmentToken: string) => {
    setAccessToken(enrollmentToken);
  }, []);

  const completeEnrollment = useCallback(async (tokens: AuthTokens) => {
    await handleAuthResponse(tokens, dispatch);
  }, []);

  const selectOrganization = useCallback(async (slug: string, organizationId?: string) => {
    const result = await withRefreshLock(async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) throw new Error("No refresh token");

      const response = await authApi.refreshToken(refreshToken, {
        organizationId,
        organizationSlug: slug,
      });
      // A refused grant still rotates the refresh token. Everything else stays on the current
      // org, whose access token is still valid.
      await setRefreshToken(response.refreshToken);
      if (response.organizationId) {
        setAccessToken(response.accessToken);
        setAssetCookie(response.assetCookie);
        await setStoredOrgId(response.organizationId, response.organizationSlug || slug);
      }
      return response;
    });

    if (!result.organizationId) {
      void queryClient.invalidateQueries({ queryKey: ["organizations", "mine"] });
      throw new Error("You no longer have access to that organization");
    }

    // Different tenant: cached queries and decoded images from the previous
    // org must not carry into the new context.
    clearSessionCaches();

    dispatch({
      type: "SET_ORGANIZATION",
      organizationId: result.organizationId,
      organizationRole: result.organizationRole || null,
      domainAdminDomains: [...result.domainAdminDomains],
    });
    emitAuthBoundary(result.organizationId);
  }, []);

  const logout = useCallback(
    async (options?: { discardUnsynced?: boolean }): Promise<LogoutResult> => {
      const userId = state.user?.id;
      if (userId && !options?.discardUnsynced) {
        const organizationIds = await listUnsyncedOrganizations(userId).then(
          (ids) => (ids.length ? ids : null),
          // A check that failed names no organization but still asks.
          () => [],
        );
        if (organizationIds) return { status: "unsynced", organizationIds };
      }
      if (userId) await clearUserSessionData(userId);
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        try {
          await authApi.logout(refreshToken);
        } catch {
          // Non-fatal: clear local state even if server revocation fails
        }
      }
      await clearAuthStorage();
      clearSessionCaches();
      dispatch({ type: "LOGOUT" });
      emitAuthBoundary(null);
      return { status: "signed_out" };
    },
    [state.user],
  );

  const value: AuthContextValue = {
    ...state,
    login,
    verifyMfa,
    register,
    acceptInvitation,
    beginForcedEnrollment,
    completeEnrollment,
    selectOrganization,
    logout,
    holdNavigation,
    setHoldNavigation,
    loginSplashVisible,
    setLoginSplashVisible,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
