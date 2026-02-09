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
 * The PNG is the dark (black) logo on a transparent background.
 * In dark theme we apply filter:invert(1) to make it white.
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
      style={isDark ? { filter: 'invert(1)' } : undefined}
    />
  );
}
