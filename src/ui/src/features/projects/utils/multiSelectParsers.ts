/**
 * Parsing and formatting helpers for multi-select field values
 * stored as comma-separated strings.
 */

/**
 * Parse a multi-select field value (comma-separated string or array) into an array of option IDs.
 */
export function parseMultiSelectValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").filter(Boolean);
  return [];
}

/**
 * Format an array of option IDs into a comma-separated string for storage.
 */
export function formatMultiSelectValue(ids: string[]): string {
  return ids.join(",");
}
