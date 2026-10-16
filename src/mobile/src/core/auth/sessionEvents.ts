type Listener = () => void;

const listeners = new Set<Listener>();
const signOutHandlers = new Set<(userId: string) => Promise<void>>();
const unsyncedEditChecks = new Set<(userId: string) => Promise<boolean>>();

export function onUserSignOut(handler: (userId: string) => Promise<void>): () => void {
  signOutHandlers.add(handler);
  return () => {
    signOutHandlers.delete(handler);
  };
}

export async function clearUserSessionData(userId: string): Promise<void> {
  await Promise.all([...signOutHandlers].map((handler) => handler(userId)));
}

/** Registers a check for edits that sign-out would delete before the server saved them. */
export function onUnsyncedEditsCheck(check: (userId: string) => Promise<boolean>): () => void {
  unsyncedEditChecks.add(check);
  return () => {
    unsyncedEditChecks.delete(check);
  };
}

/** A failed check counts as unsynced, so sign-out asks instead of deleting silently. */
export async function hasUnsyncedEdits(userId: string): Promise<boolean> {
  const results = await Promise.all(
    [...unsyncedEditChecks].map((check) => check(userId).catch(() => true)),
  );
  return results.some(Boolean);
}

// Fired when the refresh token is definitively rejected by the server. The
// auth provider subscribes and drops the app back to the login screen; without
// this signal an expired session would keep browsing dead screens.
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  for (const listener of listeners) listener();
}
