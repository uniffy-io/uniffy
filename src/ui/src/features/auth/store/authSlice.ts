import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { GetCurrentUserResponse } from '@uniffy/proto/auth/v1/auth_pb';

/** accessToken stays in memory only; rehydrateAuth() re-mints it from refreshToken to limit XSS exposure. */
export interface AuthState {
  user: Omit<GetCurrentUserResponse, '$typeName'> | null;
  accessToken: string | null;
  refreshToken: string | null;
  currentOrganizationId: string | null;
  // Persisted so the refresh RPC can re-issue an org-scoped access token (keyed off the slug).
  currentOrganizationSlug: string | null;
  currentOrganizationRole: string | null;
  domainAdminDomains: number[];
  currentSessionId: string | null;
  isAuthenticated: boolean;
  isRehydrating: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  currentOrganizationId: null,
  currentOrganizationSlug: null,
  currentOrganizationRole: null,
  domainAdminDomains: [],
  currentSessionId: null,
  isAuthenticated: false,
  isRehydrating: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{
        user: Omit<GetCurrentUserResponse, '$typeName'>;
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
        organizationSlug?: string;
        organizationRole?: string;
        sessionId?: string;
        domainAdminDomains?: number[];
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.currentOrganizationId = action.payload.organizationId || null;
      state.currentOrganizationSlug =
        action.payload.organizationSlug ?? state.currentOrganizationSlug ?? null;
      state.currentOrganizationRole = action.payload.organizationRole || null;
      state.domainAdminDomains = action.payload.domainAdminDomains || [];
      state.currentSessionId = action.payload.sessionId || state.currentSessionId;
      state.isAuthenticated = true;
      state.isRehydrating = false;
    },
    startRehydrating: (state) => {
      state.isRehydrating = true;
    },
    rehydrateComplete: (
      state,
      action: PayloadAction<{
        user: Omit<GetCurrentUserResponse, '$typeName'>;
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
        organizationSlug?: string;
        organizationRole?: string;
        sessionId?: string;
        domainAdminDomains?: number[];
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.currentOrganizationId = action.payload.organizationId || state.currentOrganizationId;
      state.currentOrganizationSlug =
        action.payload.organizationSlug ?? state.currentOrganizationSlug ?? null;
      state.currentOrganizationRole = action.payload.organizationRole || state.currentOrganizationRole;
      state.domainAdminDomains = action.payload.domainAdminDomains ?? state.domainAdminDomains;
      state.currentSessionId = action.payload.sessionId || state.currentSessionId;
      state.isAuthenticated = true;
      state.isRehydrating = false;
    },
    rehydrateFailed: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.currentOrganizationId = null;
      state.currentOrganizationSlug = null;
      state.currentOrganizationRole = null;
      state.domainAdminDomains = [];
      state.currentSessionId = null;
      state.isAuthenticated = false;
      state.isRehydrating = false;
    },
    updateUser: (
      state,
      action: PayloadAction<Partial<Omit<GetCurrentUserResponse, '$typeName'>>>
    ) => {
      if (state.user) {
        state.user = { ...state.user, ...action.payload };
      }
    },
    setDomainAdminDomains: (state, action: PayloadAction<number[]>) => {
      state.domainAdminDomains = action.payload;
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.currentOrganizationId = null;
      state.currentOrganizationSlug = null;
      state.currentOrganizationRole = null;
      state.domainAdminDomains = [];
      state.currentSessionId = null;
      state.isAuthenticated = false;
      state.isRehydrating = false;
    },
  },
});

export const { setCredentials, startRehydrating, rehydrateComplete, rehydrateFailed, updateUser, setDomainAdminDomains, logout } = authSlice.actions;

export const authReducer = authSlice.reducer;
