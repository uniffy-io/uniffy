import { getUserColor } from '@/config/theme/userColors';

/** Accepts shadcn HSL triples or hex; falls back to the hashed palette for users without an accent. */
export function resolveAwarenessColor(
  accentColor: string | undefined | null,
  fallbackKey: string,
): { solid: string; translucent: string } {
  if (accentColor) {
    const trimmed = accentColor.trim();
    const hslMatch = trimmed.match(
      /^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/,
    );
    if (hslMatch) {
      return {
        solid: `hsl(${trimmed})`,
        translucent: `hsl(${trimmed} / 0.22)`,
      };
    }
    const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        solid: hex,
        translucent: `${hex}38`, // ~22% alpha
      };
    }
  }
  const fallback = getUserColor(fallbackKey);
  return {
    solid: fallback.hex,
    translucent: `${fallback.hex}38`,
  };
}
