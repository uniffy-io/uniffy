/** The active saved filter names one organization's tags and owners, so it is kept per org and user. */
const FILES_FILTER_STORAGE_PREFIX = "uniffy-files-view:filter";

export function filesFilterStorageKey(organizationId: string, userId: string): string {
  return `${FILES_FILTER_STORAGE_PREFIX}:${organizationId}:${userId}`;
}

/** Removes the filters a user left active in every organization; sign-out owns this, not a switch. */
export function clearStoredFilesFilters(userId: string): void {
  try {
    const suffix = `:${userId}`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${FILES_FILTER_STORAGE_PREFIX}:`) && key.endsWith(suffix))
        keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); nothing was stored then.
  }
}
