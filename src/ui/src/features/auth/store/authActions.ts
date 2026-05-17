/**
 * Auth Actions - Dispatchable without store import
 *
 * This module provides auth action creators that can be dispatched
 * via storeRef, avoiding circular dependencies with api.ts.
 *
 * The action types match authSlice exactly, but we create them directly
 * using the slice name and action names.
 */

import type { GetCurrentUserResponse } from '@uniffy/proto/auth/v1/auth_pb';

// Action type constants
const AUTH_SLICE_NAME = 'auth';

// Action type strings
export const AUTH_ACTION_TYPES = {
  SET_CREDENTIALS: `${AUTH_SLICE_NAME}/setCredentials`,
  START_REHYDRATING: `${AUTH_SLICE_NAME}/startRehydrating`,
  REHYDRATE_COMPLETE: `${AUTH_SLICE_NAME}/rehydrateComplete`,
  REHYDRATE_FAILED: `${AUTH_SLICE_NAME}/rehydrateFailed`,
  LOGOUT: `${AUTH_SLICE_NAME}/logout`,
} as const;

// Action creator types
export interface SetCredentialsPayload {
  user: Omit<GetCurrentUserResponse, '$typeName'>;
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationRole?: string;
  sessionId?: string;
  domainAdminDomains?: number[];
}

export interface RehydrateCompletePayload {
  user: Omit<GetCurrentUserResponse, '$typeName'>;
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationRole?: string;
  sessionId?: string;
}

// Action creators that return plain action objects
export function createSetCredentialsAction(payload: SetCredentialsPayload) {
  return {
    type: AUTH_ACTION_TYPES.SET_CREDENTIALS,
    payload,
  };
}

export function createStartRehydratingAction() {
  return {
    type: AUTH_ACTION_TYPES.START_REHYDRATING,
  };
}

export function createRehydrateCompleteAction(payload: RehydrateCompletePayload) {
  return {
    type: AUTH_ACTION_TYPES.REHYDRATE_COMPLETE,
    payload,
  };
}

export function createRehydrateFailedAction() {
  return {
    type: AUTH_ACTION_TYPES.REHYDRATE_FAILED,
  };
}

export function createLogoutAction() {
  return {
    type: AUTH_ACTION_TYPES.LOGOUT,
  };
}
