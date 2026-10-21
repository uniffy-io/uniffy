/** Per-user memory of the organization picked last on this device, read on sign-in and reload. */

const STORAGE_KEY_PREFIX = "uniffy:last-org";

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function readLastOrganizationSlug(userId: string): string | null {
  try {
    return localStorage.getItem(getStorageKey(userId)) || null;
  } catch {
    return null;
  }
}

export function writeLastOrganizationSlug(userId: string, slug: string): void {
  try {
    localStorage.setItem(getStorageKey(userId), slug);
  } catch {
    // Storage can be unavailable (private mode, quota); the picker covers a missing memory.
  }
}

export function clearLastOrganizationSlug(userId: string): void {
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {
    // Storage can be unavailable (private mode, quota); nothing to clear then.
  }
}
