// Identity colour rides the Unity Violet -> Belonging Pink axis and nothing
// else (assets/palette.md). Mirrors the web's brandGradients.ts so a type
// is painted the same hue on both clients.
import { BRAND } from "@theme/theme";

export interface BrandStops {
  start: string;
  end: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** True for the "#rrggbb" form the helpers here parse; a tag's colour arrives from the server unchecked. */
export function isHexColor(value: string | undefined): value is string {
  return !!value && HEX_COLOR.test(value);
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function mixHex(from: string, to: string, t: number): string {
  const a = channels(from);
  const b = channels(to);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** A "#rrggbb" colour at an alpha, for the tints a type paints behind itself; anything else paints nothing. */
export function withAlpha(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return "transparent";
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Point on the axis, 0 = Unity Violet, 1 = Belonging Pink. */
export function brandAxisColor(t: number): string {
  return mixHex(BRAND.violet, BRAND.pink, Math.min(1, Math.max(0, t)));
}

interface RampOptions {
  /** How far along the axis a single item's own gradient travels. */
  span?: number;
  /** Darkening applied to both stops, for white content on top. */
  shade?: number;
}

/** Stops for the item at `index` of an ordered set walking the axis end to end. */
export function brandRampStops(
  index: number,
  total: number,
  { span = 0.3, shade = 0 }: RampOptions = {},
): BrandStops {
  const position = total > 1 ? index / (total - 1) : 0;
  const start = brandAxisColor(position * (1 - span));
  const end = brandAxisColor(position * (1 - span) + span);
  return {
    start: shade > 0 ? mixHex(start, "#000000", shade) : start,
    end: shade > 0 ? mixHex(end, "#000000", shade) : end,
  };
}
