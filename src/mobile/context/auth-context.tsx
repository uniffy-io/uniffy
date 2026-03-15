import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import type { AuthResponse } from "@/gen/auth/v1/auth_pb";
import type { CurrentUserResponse } from "@/gen/auth/v1/auth_pb";
import type { CurrentUser } from "@/lib/types";
import {
  setAccessToken,
  setRefreshToken,
  getRefreshToken,
  setStoredOrgId,
  getStoredOrgId,
  clearAuthStorage,
} from "@/lib/auth";
import { authApi } from "@/api/authApi";

interface AuthState {
  user: CurrentUser | null;
  organizationId: string | null;
  organizationRole: string | null;
  isAuthenticated: boolean;
  isRehydrating: boolean;
}

type AuthAction =
  | {
      type: "SET_AUTHENTICATED";
      user: CurrentUser;
      organizationId: string | null;
      organizationRole: string | null;
    }
  | { type: "SET_ORGANIZATION"; organizationId: string; organizationRole: string | null }
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
        isAuthenticated: true,
        isRehydrating: false,
      };
    case "SET_ORGANIZATION":
      return {
        ...state,
        organizationId: action.organizationId,
        organizationRole: action.organizationRole,
      };
    case "SET_REHYDRATING":
      return { ...state, isRehydrating: action.value };
    case "LOGOUT":
      return {
        user: null,
        organizationId: null,
        organizationRole: null,
        isAuthenticated: false,
        isRehydrating: false,
      };
    default:
      return state;
  }
}

function toCurrentUser(response: CurrentUserResponse): CurrentUser {
  return {
    id: response.id,
    email: response.email,
    username: response.username,
    fullName: response.fullName,
    avatarUrl: response.avatarUrl,
    accentColor: response.accentColor,
    fontFamily: response.fontFamily,
    isActive: response.isActive,
    isSystemAdmin: response.isSystemAdmin,
    emailVerified: response.emailVerified,
  };
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>;
  selectOrganization: (slug: string) => Promise<void>;
  logout: () => Promise<void>;
  holdNavigation: boolean;
  setHoldNavigation: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function handleAuthResponse(
  response: AuthResponse,
  dispatch: React.Dispatch<AuthAction>,
): Promise<void> {
  setAccessToken(response.accessToken);
  await setRefreshToken(response.refreshToken);

  if (response.organizationId) {
    await setStoredOrgId(response.organizationId);
  }

  const user = await authApi.getCurrentUser();

  dispatch({
    type: "SET_AUTHENTICATED",
    user: toCurrentUser(user),
    organizationId: response.organizationId ?? null,
    organizationRole: response.organizationRole ?? null,
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [holdNavigation, setHoldNavigation] = useState(false);
  const [state, dispatch] = useReducer(authReducer, {
    user: null,
    organizationId: null,
    organizationRole: null,
    isAuthenticated: false,
    isRehydrating: true,
  });

  // Rehydrate on mount: check for stored refresh token
  useEffect(() => {
    let cancelled = false;

    async function rehydrate() {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          dispatch({ type: "SET_REHYDRATING", value: false });
          return;
        }

        const storedOrgId = await getStoredOrgId();
        const response = await authApi.refreshToken(refreshToken);

        if (cancelled) return;

        setAccessToken(response.accessToken);
        await setRefreshToken(response.refreshToken);

        const orgId = response.organizationId ?? storedOrgId ?? null;
        if (orgId) {
          await setStoredOrgId(orgId);
        }

        const user = await authApi.getCurrentUser();

        if (cancelled) return;

        dispatch({
          type: "SET_AUTHENTICATED",
          user: toCurrentUser(user),
          organizationId: orgId,
          organizationRole: response.organizationRole ?? null,
        });
      } catch {
        await clearAuthStorage();
        if (!cancelled) {
          dispatch({ type: "LOGOUT" });
        }
      }
    }

    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    await handleAuthResponse(response, dispatch);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string, fullName?: string) => {
      const response = await authApi.register(email, username, password, fullName);
      await handleAuthResponse(response, dispatch);
    },
    [],
  );

  const selectOrganization = useCallback(async (slug: string) => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) throw new Error("No refresh token");

    const response = await authApi.refreshToken(refreshToken, slug);
    setAccessToken(response.accessToken);
    await setRefreshToken(response.refreshToken);

    const orgId = response.organizationId ?? "";
    await setStoredOrgId(orgId);

    dispatch({
      type: "SET_ORGANIZATION",
      organizationId: orgId,
      organizationRole: response.organizationRole ?? null,
    });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Non-fatal: clear local state even if server revocation fails
      }
    }
    await clearAuthStorage();
    dispatch({ type: "LOGOUT" });
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    selectOrganization,
    logout,
    holdNavigation,
    setHoldNavigation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
