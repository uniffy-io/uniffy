import { brandAxisColor } from "@/config/theme/brandGradients";

/**
 * Series colours for charts, spread evenly along the brand axis so a chart reads as one family
 * with the avatars and statuses rather than adding a second palette.
 */
export function chartSeriesColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [brandAxisColor(0)];
  return Array.from({ length: count }, (_, index) => brandAxisColor(index / (count - 1)));
}

/** Theme-token styling every chart shares, so axes and grids follow light and dark. */
export const CHART_THEME = {
  tick: { fontSize: 11, fill: "var(--color-muted-foreground)" },
  grid: "var(--color-border)",
  cursor: { fill: "var(--color-foreground)", fillOpacity: 0.05 },
  tooltip: {
    contentStyle: {
      background: "var(--color-popover)",
      border: "none",
      borderRadius: 8,
      boxShadow: "var(--shadow-float)",
      color: "var(--color-popover-foreground)",
      fontSize: 12,
    },
    labelStyle: { color: "var(--color-muted-foreground)" },
  },
} as const;
