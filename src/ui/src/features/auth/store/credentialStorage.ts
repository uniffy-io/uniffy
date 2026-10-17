import type { AuthState } from "@/features/auth/store/authSlice";

export const AUTH_STORAGE_KEY = "uniffy:auth";

export function readStoredAuth(): AuthState | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored !== null) return JSON.parse(stored) as AuthState | null;
    const root = JSON.parse(localStorage.getItem("persist:root") || "{}");
    const auth = JSON.parse(root.auth || "null") as AuthState | null;
    if (auth) writeStoredAuth(auth);
    return auth;
  } catch {
    return null;
  }
}

export function writeStoredAuth(auth: AuthState | null): void {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(
      auth && { ...auth, accessToken: null, isAuthenticated: false, isRehydrating: false },
    ),
  );
}

// Redux persistence can write stale tab state after any unrelated action.
export const credentialSafeStorage = {
  async getItem(key: string): Promise<string | null> {
    const auth = readStoredAuth();
    const root = JSON.parse(localStorage.getItem(key) || "{}");
    if (auth) root.auth = JSON.stringify(auth);
    else delete root.auth;
    return JSON.stringify(root);
  },
  async setItem(key: string, value: string): Promise<void> {
    const root = JSON.parse(value);
    delete root.auth;
    localStorage.setItem(key, JSON.stringify(root));
  },
  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};
