import type { AuditFilter } from "@/components/audit/types";

const PRESETS = {
  today: 0,
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

export type DateRangePreset = keyof typeof PRESETS | "custom" | "all";

export const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
];

export function presetBounds(
  preset: DateRangePreset,
  now: Date = new Date(),
): { fromTime: string | null; toTime: string | null } {
  if (preset === "all" || preset === "custom") {
    return { fromTime: null, toTime: null };
  }
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { fromTime: start.toISOString(), toTime: now.toISOString() };
  }
  const days = PRESETS[preset];
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { fromTime: start.toISOString(), toTime: now.toISOString() };
}

export function detectActivePreset(filter: AuditFilter): DateRangePreset {
  if (!filter.fromTime && !filter.toTime) return "all";
  for (const preset of ["today", "7d", "30d", "90d"] as const) {
    const bounds = presetBounds(preset);
    if (
      bounds.fromTime &&
      filter.fromTime &&
      Math.abs(new Date(bounds.fromTime).getTime() - new Date(filter.fromTime).getTime()) < 60_000
    ) {
      return preset;
    }
  }
  return "custom";
}
