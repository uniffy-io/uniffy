import type { ThemeColors } from "@/constants/theme";

type Hsl = { h: number; s: number; l: number };

// Accent colors are stored in the shadcn space-separated HSL form, e.g.
// "250.3 100% 64.5%" (hue, saturation%, lightness%).
function parseHsl(hsl: string): Hsl | null {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]);
  const l = parseFloat(parts[2]);
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lum - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hslToHex(hsl: string): string {
  const parsed = parseHsl(hsl);
  if (!parsed) return "#694aff";
  return toHex(hslToRgb(parsed));
}

type AccentOverrides = Pick<ThemeColors, "accent" | "accentSoft" | "accentGlow">;

export function buildAccentColors(hsl: string | null, isDark: boolean): Partial<AccentOverrides> {
  const parsed = hsl ? parseHsl(hsl) : null;
  if (!parsed) return {};
  const [r, g, b] = hslToRgb(parsed);
  const softAlpha = isDark ? 0.12 : 0.08;
  const glowAlpha = isDark ? 0.25 : 0.15;
  return {
    accent: toHex([r, g, b]),
    accentSoft: `rgba(${r},${g},${b},${softAlpha})`,
    accentGlow: `rgba(${r},${g},${b},${glowAlpha})`,
  };
}
