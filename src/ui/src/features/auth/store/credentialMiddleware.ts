import { isAction, type Middleware } from "@reduxjs/toolkit";
import { AUTH_ACTION_TYPES } from "@/features/auth/store/authActions";
import type { AuthState } from "@/features/auth/store/authSlice";
import { readStoredAuth, writeStoredAuth } from "@/features/auth/store/credentialStorage";

export const credentialMiddleware: Middleware<{}, { auth: AuthState }> =
  (store) => (next) => (action) => {
    const before = store.getState().auth;
    const result = next(action);
    if (
      !isAction(action) ||
      ("meta" in action && (action.meta as { external?: boolean })?.external)
    )
      return result;
    if (action.type === AUTH_ACTION_TYPES.SET_CREDENTIALS) {
      writeStoredAuth(store.getState().auth);
      if (typeof window !== "undefined") window.dispatchEvent(new Event("uniffy:auth:refreshed"));
    } else if (
      action.type === AUTH_ACTION_TYPES.LOGOUT ||
      action.type === AUTH_ACTION_TYPES.REHYDRATE_FAILED
    ) {
      const stored = readStoredAuth();
      if (stored?.refreshToken === before.refreshToken) writeStoredAuth(null);
    }
    return result;
  };
