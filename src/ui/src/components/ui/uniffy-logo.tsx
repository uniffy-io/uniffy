import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/config/theme/ThemeProvider';
import { cn } from '@/shared/utils/cn';

interface UniffyLogoProps {
  className?: string;
  /** Force a specific variant regardless of theme */
  variant?: 'light' | 'dark';
}

/**
 * Processes the source PNG (dark logo on white background) into a
 * transparent-background data URL using an offscreen canvas.
 * Pixels brighter than the threshold become fully transparent;
 * the remaining logo pixels are recolored to the target color.
 */
function useTransparentLogo(color: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (cacheRef.current[color]) {
      setDataUrl(cacheRef.current[color]);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Parse target color
      const temp = document.createElement('div');
      temp.style.color = color;
      document.body.appendChild(temp);
      const computed = getComputedStyle(temp).color;
      document.body.removeChild(temp);
      const match = computed.match(/(\d+)/g);
      const [tr, tg, tb] = match ? match.map(Number) : [0, 0, 0];

      // Process pixels: white background -> transparent, dark logo -> target color
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        // Logo pixels are dark (brightness < 200), background is white (brightness >= 200)
        const logoOpacity = Math.max(0, Math.min(1, (200 - brightness) / 160));
        data[i] = tr;
        data[i + 1] = tg;
        data[i + 2] = tb;
        data[i + 3] = Math.round(logoOpacity * 255);
      }

      ctx.putImageData(imageData, 0, 0);
      const url = canvas.toDataURL('image/png');
      cacheRef.current[color] = url;
      setDataUrl(url);
    };
    img.src = '/web-app-manifest-512x512.png';
  }, [color]);

  return dataUrl;
}

/**
 * Cross-browser Uniffy logo that adapts to theme.
 *
 * The source PNG has a dark logo on an opaque white background. At mount time,
 * the component processes it through a canvas to remove the background and
 * recolor the logo for the current theme. The result is cached per color.
 */
export function UniffyLogo({ className, variant }: UniffyLogoProps) {
  const { resolvedTheme } = useTheme();

  const isDark = variant
    ? variant === 'dark'
    : resolvedTheme === 'dark';

  const logoColor = isDark ? '#ffffff' : '#000000';
  const dataUrl = useTransparentLogo(logoColor);

  if (!dataUrl) {
    // Placeholder while processing - invisible same-size element
    return <div className={cn('select-none', className)} role="img" aria-label="Uniffy" />;
  }

  return (
    <img
      src={dataUrl}
      alt="Uniffy"
      className={cn('select-none', className)}
    />
  );
}
