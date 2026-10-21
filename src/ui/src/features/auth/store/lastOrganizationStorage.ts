/** Per-user memory of the organization picked last on this device, read on sign-in and reload. */

const STORAGE_KEY_PREFIX = "uniffy:last-org";

export interface LastOrganization {
  id?: string;
  slug: string;
}

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

// Older records hold the bare slug; a JSON record adds the id so a refused fresh tab can still
// name the lost organization.
export function readLastOrganization(userId: string): LastOrganization | null {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    if (!raw.startsWith("{")) return { slug: raw };
    const parsed = JSON.parse(raw) as Partial<LastOrganization>;
    if (typeof parsed.slug !== "string" || !parsed.slug) return null;
    return typeof parsed.id === "string" && parsed.id
      ? { id: parsed.id, slug: parsed.slug }
      : { slug: parsed.slug };
  } catch {
    return null;
  }
}

export function readLastOrganizationSlug(userId: string): string | null {
  return readLastOrganization(userId)?.slug ?? null;
}

export function writeLastOrganization(userId: string, organization: LastOrganization): void {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(organization));
  } catch {
    // Storage can be unavailable (private mode, quota); the picker covers a missing memory.
  }
}

export function writeLastOrganizationSlug(userId: string, slug: string): void {
  const current = readLastOrganization(userId);
  writeLastOrganization(userId, current?.slug === slug && current.id ? current : { slug });
}

export function clearLastOrganizationSlug(userId: string): void {
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {
    // Storage can be unavailable (private mode, quota); nothing to clear then.
  }
}
