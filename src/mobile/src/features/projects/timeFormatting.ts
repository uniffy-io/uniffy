/** Renders minutes as "30m", "1h", or "2h 30m". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

/** Accepts "2h", "2h 30m", "30m", "2.5h", or plain minutes. Returns null on invalid. */
export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const hm = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?$/);
  if (hm) {
    const hours = parseFloat(hm[1]);
    const mins = parseInt(hm[2] || "0", 10);
    return Math.round(hours * 60 + mins);
  }

  const m = trimmed.match(/^(\d+)\s*m$/);
  if (m) return parseInt(m[1], 10);

  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0) return Math.round(num);

  return null;
}
