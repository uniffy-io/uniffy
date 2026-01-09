import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UserInfoResponse } from '@/gen/auth/v1/auth_pb';
import type { PlainMessage } from '@bufbuild/protobuf';

interface AuthState {
  user: PlainMessage<UserInfoResponse> | null;
  accessToken: string | null;
  refreshToken: string | null;
  currentOrganizationId: string | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  currentOrganizationId: null,
  isAuthenticated: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ 
        user: PlainMessage<UserInfoResponse>; 
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.currentOrganizationId = action.payload.organizationId || null;
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.currentOrganizationId = null;
      state.isAuthenticated = false;
    },
  },
});

export const { setCredentials, logout } = authSlice.actions;

export default authSlice.reducer;
