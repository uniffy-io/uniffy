/** Plain action creators dispatchable via storeRef so api.ts avoids a circular import on authSlice. */

import { createAction, type Action } from "@reduxjs/toolkit";
import type { GetCurrentUserResponse } from "@uniffy/proto/auth/v1/auth_pb";

const AUTH_SLICE_NAME = "auth";

export const AUTH_ACTION_TYPES = {
  SET_CREDENTIALS: `${AUTH_SLICE_NAME}/setCredentials`,
  START_REHYDRATING: `${AUTH_SLICE_NAME}/startRehydrating`,
  REHYDRATE_COMPLETE: `${AUTH_SLICE_NAME}/rehydrateComplete`,
  REHYDRATE_FAILED: `${AUTH_SLICE_NAME}/rehydrateFailed`,
  LOGOUT: `${AUTH_SLICE_NAME}/logout`,
} as const;

export interface SetCredentialsPayload {
  user: Omit<GetCurrentUserResponse, "$typeName">;
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationSlug?: string;
  organizationRole?: string;
  sessionId?: string;
  domainAdminDomains?: number[];
}

export interface RehydrateCompletePayload {
  user: Omit<GetCurrentUserResponse, "$typeName">;
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  organizationSlug?: string;
  organizationRole?: string;
  sessionId?: string;
  domainAdminDomains?: number[];
}

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

/** Drops the previous organization's data from every slice while the session itself stays signed in. */
export const resetOrganizationScope = createAction(`${AUTH_SLICE_NAME}/resetOrganizationScope`);

export function endsOrganizationScope(action: Action): boolean {
  return action.type === AUTH_ACTION_TYPES.LOGOUT || resetOrganizationScope.match(action);
}
