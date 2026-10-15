type Listener = () => void;

const listeners = new Set<Listener>();
const signOutHandlers = new Set<(userId: string) => Promise<void>>();

export function onUserSignOut(handler: (userId: string) => Promise<void>): () => void {
  signOutHandlers.add(handler);
  return () => {
    signOutHandlers.delete(handler);
  };
}

export async function clearUserSessionData(userId: string): Promise<void> {
  await Promise.all([...signOutHandlers].map((handler) => handler(userId)));
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
