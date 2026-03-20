/**
 * Time formatting utilities for task time tracking.
 *
 * Handles converting minutes to display strings and parsing user input.
 */

/**
 * Format minutes into a human-readable string.
 *
 * Examples: 30 -> "30m", 60 -> "1h", 150 -> "2h 30m"
 */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

/**
 * Parse a time input string into minutes.
 *
 * Supported formats:
 * - "2h" -> 120
 * - "2h 30m" -> 150
 * - "30m" -> 30
 * - "2.5h" -> 150
 * - "150" -> 150 (plain number = minutes)
 *
 * Returns null for invalid input.
 */
export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Try "Xh Ym" or "Xh" format
  const hm = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?$/);
  if (hm) {
    const hours = parseFloat(hm[1]);
    const mins = parseInt(hm[2] || "0", 10);
    return Math.round(hours * 60 + mins);
  }

  // Try "Xm" format
  const m = trimmed.match(/^(\d+)\s*m$/);
  if (m) return parseInt(m[1], 10);

  // Try plain number (minutes)
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0) return Math.round(num);

  return null;
}
