/** The organization this tab is in, kept per tab so a reload returns here and not to another tab's pick. */

const STORAGE_KEY_PREFIX = "uniffy:tab-org";

export interface TabOrganization {
  id: string;
  slug: string;
}

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function readTabOrganization(userId: string): TabOrganization | null {
  try {
    const raw = sessionStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabOrganization>;
    if (typeof parsed.id !== "string" || !parsed.id || typeof parsed.slug !== "string") return null;
    return { id: parsed.id, slug: parsed.slug };
  } catch {
    return null;
  }
}

export function writeTabOrganization(userId: string, organization: TabOrganization): void {
  try {
    sessionStorage.setItem(getStorageKey(userId), JSON.stringify(organization));
  } catch {
    // Storage can be unavailable (private mode, quota); the device memory covers a reload then.
  }
}

export function clearTabOrganization(userId: string): void {
  try {
    sessionStorage.removeItem(getStorageKey(userId));
  } catch {
    // Storage can be unavailable (private mode, quota); nothing to clear then.
  }
}
