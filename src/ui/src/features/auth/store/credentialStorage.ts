import type { AuthState } from "@/features/auth/store/authSlice";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";

export const AUTH_STORAGE_KEY = "uniffy:auth";

/** The device-wide record carries the session only; each tab keeps its own organization. */
function withoutOrganization(auth: AuthState): AuthState {
  return {
    ...auth,
    currentOrganizationId: null,
    currentOrganizationSlug: null,
    currentOrganizationRole: null,
    domainAdminDomains: [],
  };
}

export function readStoredAuth(): AuthState | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored !== null) {
      const auth = JSON.parse(stored) as AuthState | null;
      return auth && withoutOrganization(auth);
    }
    const root = JSON.parse(localStorage.getItem("persist:root") || "{}");
    const auth = JSON.parse(root.auth || "null") as AuthState | null;
    if (auth) writeStoredAuth(auth);
    return auth && withoutOrganization(auth);
  } catch {
    return null;
  }
}

const ORGANIZATION_FIELDS = [
  "currentOrganizationId",
  "currentOrganizationSlug",
  "currentOrganizationRole",
  "domainAdminDomains",
] as const satisfies readonly (keyof AuthState)[];

export function writeStoredAuth(auth: AuthState | null): void {
  let session: Partial<AuthState> | null = null;
  if (auth) {
    session = { ...auth, accessToken: null, isAuthenticated: false, isRehydrating: false };
    for (const field of ORGANIZATION_FIELDS) delete session[field];
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

/** A reload starts from the organization this tab was in; the refresh still decides whether it is granted. */
function withTabOrganization(auth: AuthState): AuthState {
  const organization = auth.user ? readTabOrganization(auth.user.id) : null;
  if (!organization) return auth;
  return {
    ...auth,
    currentOrganizationId: organization.id,
    currentOrganizationSlug: organization.slug || null,
  };
}

/** Serialized slices this tab last read or wrote, per storage key. */
const knownSlices = new Map<string, Map<string, string>>();

function knownSlicesFor(key: string): Map<string, string> {
  let known = knownSlices.get(key);
  if (!known) {
    known = new Map();
    knownSlices.set(key, known);
  }
  return known;
}

function readRoot(key: string): Record<string, string> {
  const root = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>;
  delete root.auth;
  return root;
}

/**
 * Every tab persists into one blob, and redux-persist writes the whole tab state after any action.
 * Only slices this tab changed are written, so an untouched stale slice never overwrites another
 * tab's newer one, and auth never rides along.
 */
export const credentialSafeStorage = {
  async getItem(key: string): Promise<string | null> {
    const root = readRoot(key);
    const known = knownSlicesFor(key);
    for (const [slice, serialized] of Object.entries(root)) known.set(slice, serialized);
    const auth = readStoredAuth();
    const merged: Record<string, string> = { ...root };
    if (auth) merged.auth = JSON.stringify(withTabOrganization(auth));
    return JSON.stringify(merged);
  },
  async setItem(key: string, value: string): Promise<void> {
    const next = JSON.parse(value) as Record<string, string>;
    delete next.auth;
    const known = knownSlicesFor(key);
    const root = readRoot(key);
    for (const [slice, serialized] of Object.entries(next)) {
      if (known.get(slice) === serialized) continue;
      root[slice] = serialized;
      known.set(slice, serialized);
    }
    localStorage.setItem(key, JSON.stringify(root));
  },
  async removeItem(key: string): Promise<void> {
    knownSlices.delete(key);
    localStorage.removeItem(key);
  },
};
