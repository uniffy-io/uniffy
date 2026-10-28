type Listener = () => void;

const sessionExpiredListeners = new Set<Listener>();
const organizationLostListeners = new Set<Listener>();
const authBoundaryListeners = new Set<(organizationId: string | null) => void>();
const signOutHandlers = new Set<(userId: string) => Promise<void>>();
const unsyncedEditChecks = new Set<(userId: string) => Promise<readonly string[]>>();

export function onUserSignOut(handler: (userId: string) => Promise<void>): () => void {
  signOutHandlers.add(handler);
  return () => {
    signOutHandlers.delete(handler);
  };
}

export async function clearUserSessionData(userId: string): Promise<void> {
  await Promise.all([...signOutHandlers].map((handler) => handler(userId)));
}

/** Registers a check that names the organizations whose edits sign-out would delete before the
 * server saved them. */
export function onUnsyncedEditsCheck(
  check: (userId: string) => Promise<readonly string[]>,
): () => void {
  unsyncedEditChecks.add(check);
  return () => {
    unsyncedEditChecks.delete(check);
  };
}

/** Organizations holding edits only this device has, each once. A failed check rejects, so
 * sign-out asks instead of deleting silently. */
export async function listUnsyncedOrganizations(userId: string): Promise<string[]> {
  const results = await Promise.all([...unsyncedEditChecks].map((check) => check(userId)));
  return [...new Set(results.flat())];
}

// Fired when the refresh token is definitively rejected by the server. The
// auth provider subscribes and drops the app back to the login screen; without
// this signal an expired session would keep browsing dead screens.
export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

// Fired when a refresh comes back without the organization this device was in. The session
// lives on, so the auth provider drops that org's data and returns to the organization picker
// instead of signing out.
export function onOrganizationLost(listener: Listener): () => void {
  organizationLostListeners.add(listener);
  return () => {
    organizationLostListeners.delete(listener);
  };
}

export function emitOrganizationLost(): void {
  for (const listener of organizationLostListeners) listener();
}

/**
 * Fired once the credentials serve another user or organization: a sign-in, a switch or a lost
 * grant, with the organization they now serve (null for none). Anything bound to the previous
 * organization, such as the realtime socket, drops it and starts over.
 */
export function onAuthBoundary(listener: (organizationId: string | null) => void): () => void {
  authBoundaryListeners.add(listener);
  return () => {
    authBoundaryListeners.delete(listener);
  };
}

export function emitAuthBoundary(organizationId: string | null): void {
  for (const listener of authBoundaryListeners) listener(organizationId);
}
