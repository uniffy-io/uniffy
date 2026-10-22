/** Mirrors the organization slug bounds in domains/organizations/naming.py. */
export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 255;

/** The slug a field shows while typing: a trailing hyphen stays so the next word can follow it. */
export function toSlugDraft(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_SLUG_LENGTH);
}

export function toSlug(value: string): string {
  return toSlugDraft(value).replace(/-+$/, "");
}
