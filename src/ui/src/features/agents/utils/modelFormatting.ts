export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Catalog rates arrive as decimal strings so no precision is lost on the wire;
 * an empty string means the catalog carries no rate for that model (a live-API
 * model, or a provider that prices per request). Cheap models run to four
 * decimal places, so the precision has to follow the magnitude.
 */
export function formatPricePer1M(rate: string | undefined): string | null {
  if (!rate) return null;
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "$0";

  const digits = value >= 1 ? 2 : value >= 0.1 ? 3 : 4;
  const trimmed = value.toFixed(digits).replace(/\.?0+$/, "");
  return `$${trimmed}`;
}
