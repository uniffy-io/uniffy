/** Multi-select values are stored as comma-separated strings. */
export function parseMultiSelectValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").filter(Boolean);
  return [];
}

export function formatMultiSelectValue(ids: string[]): string {
  return ids.join(",");
}
