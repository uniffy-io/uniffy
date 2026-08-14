const STORAGE_KEY_PREFIX = "uniffy-last-note";

function getStorageKey(organizationId: string, userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${organizationId}:${userId}`;
}

export function loadLastOpenedNote(organizationId: string, userId: string): string | null {
  try {
    return localStorage.getItem(getStorageKey(organizationId, userId));
  } catch {
    return null;
  }
}

export function saveLastOpenedNote(organizationId: string, userId: string, noteId: string): void {
  try {
    localStorage.setItem(getStorageKey(organizationId, userId), noteId);
  } catch {
    // Ignore storage errors
  }
}

export function clearLastOpenedNote(organizationId: string, userId: string): void {
  try {
    localStorage.removeItem(getStorageKey(organizationId, userId));
  } catch {
    // Ignore storage errors
  }
}
