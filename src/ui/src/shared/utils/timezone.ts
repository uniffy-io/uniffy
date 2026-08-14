/**
 * Effective display timezone: the user's stored preference when set, the
 * browser zone otherwise. Kept as module state (synced from the settings
 * store) so non-React date utils can read it without a hook.
 */

let preferredTimeZone: string | null = null;

export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function setPreferredTimeZone(timeZone: string | null): void {
  preferredTimeZone = timeZone || null;
}

export function getPreferredTimeZone(): string | null {
  return preferredTimeZone;
}

export function getEffectiveTimeZone(): string {
  return preferredTimeZone ?? getBrowserTimeZone();
}

/** Zone id as a reader sees it ("Europe/Sofia"). Underscores are the only change,
 *  so the label matches the id shown in the settings picker. */
export function formatTimeZoneLabel(timeZone: string = getEffectiveTimeZone()): string {
  return timeZone.replace(/_/g, " ");
}
