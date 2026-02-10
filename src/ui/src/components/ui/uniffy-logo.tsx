import { useTheme } from '@/config/theme/ThemeProvider';
import { cn } from '@/shared/utils/cn';

interface UniffyLogoProps {
  className?: string;
  /** Force a specific variant regardless of theme */
  variant?: 'light' | 'dark';
}

/**
 * Cross-browser Uniffy logo that adapts to theme.
 *
 * Uses the PNG source instead of the SVG because the SVG contains embedded
 * CSS media queries and base64 PNGs that cause filter:invert() to break
 * in Safari. PNGs handle CSS filters reliably across all browsers.
 *
 * The PNG is a dark (black) logo on an opaque white background.
 * mix-blend-mode eliminates the background:
 *   - Light theme: multiply (white bg becomes transparent, black logo stays)
 *   - Dark theme: screen + invert (black bg becomes transparent, white logo stays)
 */
export function UniffyLogo({ className, variant }: UniffyLogoProps) {
  const { resolvedTheme } = useTheme();

  const isDark = variant
    ? variant === 'dark'
    : resolvedTheme === 'dark';

  return (
    <img
      src="/web-app-manifest-512x512.png"
      alt="Uniffy"
      className={cn('select-none', className)}
      style={{
        filter: isDark ? 'invert(1)' : undefined,
        mixBlendMode: isDark ? 'screen' : 'multiply',
      }}
    />
  );
}
