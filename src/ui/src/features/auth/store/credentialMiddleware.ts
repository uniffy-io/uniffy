import { isAction, type Middleware } from "@reduxjs/toolkit";
import { AUTH_ACTION_TYPES } from "@/features/auth/store/authActions";
import type { AuthState } from "@/features/auth/store/authSlice";
import { readStoredAuth, writeStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  clearTabOrganization,
  writeTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";

function rememberTabOrganization(auth: AuthState): void {
  if (!auth.user) return;
  if (auth.currentOrganizationId) {
    writeTabOrganization(auth.user.id, {
      id: auth.currentOrganizationId,
      slug: auth.currentOrganizationSlug ?? "",
    });
  } else {
    clearTabOrganization(auth.user.id);
  }
}

export const credentialMiddleware: Middleware<{}, { auth: AuthState }> =
  (store) => (next) => (action) => {
    const before = store.getState().auth;
    const result = next(action);
    if (!isAction(action)) return result;
    // A sign-out mirrored from another tab already wrote the shared record; this tab's own
    // organization memory is still its to clear.
    const external = "meta" in action && (action.meta as { external?: boolean })?.external;
    if (action.type === AUTH_ACTION_TYPES.SET_CREDENTIALS) {
      const auth = store.getState().auth;
      rememberTabOrganization(auth);
      if (external) return result;
      writeStoredAuth(auth);
      if (typeof window !== "undefined") window.dispatchEvent(new Event("uniffy:auth:refreshed"));
    } else if (
      action.type === AUTH_ACTION_TYPES.LOGOUT ||
      action.type === AUTH_ACTION_TYPES.REHYDRATE_FAILED
    ) {
      if (before.user) clearTabOrganization(before.user.id);
      if (external) return result;
      const stored = readStoredAuth();
      if (stored?.refreshToken === before.refreshToken) writeStoredAuth(null);
    }
    return result;
  };
