/**
 * Convert a string into a URL-friendly slug.
 *
 * Lowercases, strips non-alphanumeric characters (except hyphens),
 * replaces whitespace with hyphens, and collapses consecutive hyphens.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
