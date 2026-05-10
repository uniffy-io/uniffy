import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { GetCurrentUserResponse } from '@uniffy/proto/auth/v1/auth_pb';
import type { PlainMessage } from '@bufbuild/protobuf';

/**
 * Auth state shape.
 *
 * Security note: accessToken is stored in memory only (not persisted to localStorage)
 * to reduce XSS attack surface. On page reload, the app uses refreshToken to get
 * a new accessToken via the rehydrateAuth() function.
 */
export interface AuthState {
  user: PlainMessage<GetCurrentUserResponse> | null;
  accessToken: string | null; // Memory only - never persisted
  refreshToken: string | null; // Persisted for session continuity
  currentOrganizationId: string | null;
  currentOrganizationRole: string | null; // MEMBER, ADMIN, or OWNER
  domainAdminDomains: number[]; // DomainType enum values where user is domain admin
  currentSessionId: string | null; // Server-side session identifier
  isAuthenticated: boolean;
  isRehydrating: boolean; // True while refreshing token on app startup
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  currentOrganizationId: null,
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
        user: PlainMessage<GetCurrentUserResponse>;
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
        organizationRole?: string;
        sessionId?: string;
        domainAdminDomains?: number[];
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.currentOrganizationId = action.payload.organizationId || null;
      state.currentOrganizationRole = action.payload.organizationRole || null;
      state.domainAdminDomains = action.payload.domainAdminDomains || [];
      state.currentSessionId = action.payload.sessionId || state.currentSessionId;
      state.isAuthenticated = true;
      state.isRehydrating = false;
    },
    /**
     * Start rehydrating auth state (refreshing access token on app startup).
     */
    startRehydrating: (state) => {
      state.isRehydrating = true;
    },
    /**
     * Rehydration complete - set user and tokens from refresh response.
     */
    rehydrateComplete: (
      state,
      action: PayloadAction<{
        user: PlainMessage<GetCurrentUserResponse>;
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
        organizationRole?: string;
        sessionId?: string;
        domainAdminDomains?: number[];
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.currentOrganizationId = action.payload.organizationId || state.currentOrganizationId;
      state.currentOrganizationRole = action.payload.organizationRole || state.currentOrganizationRole;
      state.domainAdminDomains = action.payload.domainAdminDomains ?? state.domainAdminDomains;
      state.currentSessionId = action.payload.sessionId || state.currentSessionId;
      state.isAuthenticated = true;
      state.isRehydrating = false;
    },
    /**
     * Rehydration failed - clear auth state.
     */
    rehydrateFailed: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.currentOrganizationId = null;
      state.currentOrganizationRole = null;
      state.domainAdminDomains = [];
      state.currentSessionId = null;
      state.isAuthenticated = false;
      state.isRehydrating = false;
    },
    /**
     * Update user profile fields (e.g., after avatar upload/delete).
     */
    updateUser: (
      state,
      action: PayloadAction<Partial<PlainMessage<GetCurrentUserResponse>>>
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
