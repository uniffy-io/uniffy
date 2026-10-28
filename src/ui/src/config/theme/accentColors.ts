/** Accent quick picks, as the HSL triplets ThemeProvider writes to --primary. */
export const ACCENT_COLORS = [
  { name: "Blue", value: "217 91% 60%" },
  { name: "Sky", value: "199 84% 50%" },
  { name: "Purple", value: "262.1 83.3% 57.8%" },
  { name: "Green", value: "142.1 76.2% 36.3%" },
  { name: "Orange", value: "24.6 95% 53.1%" },
  { name: "Red", value: "0 84.2% 60.2%" },
  { name: "Pink", value: "330 81% 60%" },
  { name: "Teal", value: "174 72% 40%" },
  { name: "Amber", value: "38 92% 50%" },
] as const;

/** The default --primary when no accent is set. */
export const BRAND_ACCENT_HEX = "#694aff";

export function hslToHex(hsl: string, fallback: string = BRAND_ACCENT_HEX): string {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length !== 3) return fallback;

  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if ([h, s, l].some(Number.isNaN)) return fallback;

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "217 91% 60%";

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}
