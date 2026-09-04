import { brandAlpha, brandGradient, brandRampStops, mixHex } from "@/config/theme/brandGradients";
import type { SelectOption } from "@/features/projects/types";

export interface StatusPaint {
  /** Dots, icons, and pill text. */
  solid: string;
  /** Bars and swatches. */
  gradient: string;
  /** Pill background. */
  translucent: string;
}

/** Override choices offered in project settings: the brand axis, the other brand primaries, a neutral. */
export const STATUS_SWATCHES: readonly string[] = [
  "#694aff",
  "#8e57fa",
  "#b364f4",
  "#d871ef",
  "#fd7eea",
  "#01b77f",
  "#fb6127",
  "#6b7280",
];

const NEUTRAL: StatusPaint = {
  solid: "#6b7280",
  gradient: "linear-gradient(135deg, #6b7280, #6b7280)",
  translucent: brandAlpha("#6b7280", 0.18),
};

function bySortOrder(options: SelectOption[]): SelectOption[] {
  return [...options].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The backend assigns every status its slot on the brand axis (status_colors.py) unless a
 * colour was picked in project settings. A status still on its slot keeps the avatar
 * treatment, a short slice of the axis; an override paints flat, lifted at the far end so
 * bars still read as a gradient. Sending an empty colour asks the backend for a fresh slot.
 */
export function statusPaint(options: SelectOption[], statusId: string | undefined): StatusPaint {
  if (!statusId) return NEUTRAL;
  const ordered = bySortOrder(options);
  const index = ordered.findIndex((o) => o.id === statusId);
  if (index === -1) return NEUTRAL;

  const ramp = brandRampStops(index, ordered.length);
  const color = ordered[index].color?.toLowerCase();
  if (!color || color === ramp.start) {
    return {
      solid: ramp.start,
      gradient: brandGradient(ramp),
      translucent: brandAlpha(ramp.start, 0.18),
    };
  }
  return {
    solid: color,
    gradient: brandGradient({ start: color, end: mixHex(color, "#ffffff", 0.22) }),
    translucent: brandAlpha(color, 0.18),
  };
}
