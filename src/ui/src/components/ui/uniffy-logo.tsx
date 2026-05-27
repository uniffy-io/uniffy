import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/config/theme/ThemeProvider';
import { cn } from '@/shared/utils/cn';

interface UniffyLogoProps {
  className?: string;
  /** Force a specific variant regardless of theme. */
  variant?: 'light' | 'dark';
}

/** Knocks out the white background and recolors the logo pixels to `color`; result is cached per color. */
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

      // Resolve `color` (named/hex/css var) to RGB by letting the browser parse it.
      const temp = document.createElement('div');
      temp.style.color = color;
      document.body.appendChild(temp);
      const computed = getComputedStyle(temp).color;
      document.body.removeChild(temp);
      const match = computed.match(/(\d+)/g);
      const [tr, tg, tb] = match ? match.map(Number) : [0, 0, 0];

      // White background -> transparent, dark logo -> target color (threshold ~200).
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
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

export function UniffyLogo({ className, variant }: UniffyLogoProps) {
  const { resolvedTheme } = useTheme();

  const isDark = variant
    ? variant === 'dark'
    : resolvedTheme === 'dark';

  const logoColor = isDark ? '#ffffff' : '#000000';
  const dataUrl = useTransparentLogo(logoColor);

  if (!dataUrl) {
    // Invisible same-size placeholder so layout doesn't shift while we knock out the background.
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
