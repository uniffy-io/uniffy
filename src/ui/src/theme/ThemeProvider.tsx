import React, { createContext, useContext, useEffect } from 'react';
import type { Theme } from './types';
import { defaultTheme, darkTheme } from './types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setThemeName } from './themeSlice';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  availableThemes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const themes: Record<string, Theme> = {
  [defaultTheme.name]: defaultTheme,
  [darkTheme.name]: darkTheme,
};

/**
 * Calculate luminance from HSL color to determine if text should be light or dark
 * @param hsl HSL color string like "221.2 83.2% 53.3%"
 * @returns Luminance value between 0 and 1
 */
function getLuminance(hsl: string): number {
  const parts = hsl.split(' ');
  if (parts.length !== 3) return 0.5; // fallback
  
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  
  // Convert HSL to RGB
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  // Calculate relative luminance using sRGB formula
  const rsRGB = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gsRGB = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bsRGB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  
  return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const currentThemeName = useAppSelector((state) => state.theme.currentTheme);
  const accentColor = useAppSelector((state) => state.theme.accentColor);
  const fontFamily = useAppSelector((state) => state.theme.fontFamily);
  
  // Resolve the actual theme object from the name in Redux
  const theme: Theme = {
    ...themes[currentThemeName] || defaultTheme,
    accentColor: accentColor || undefined,
    fontFamily: fontFamily || undefined,
  };

  const setTheme = (newTheme: Theme) => {
    dispatch(setThemeName(newTheme.name));
  };

  // Apply theme variables to root
  useEffect(() => {
    const root = window.document.documentElement;
    
    // Remove old classes
    root.classList.remove('dark');
    
    if (theme.name === 'dark') {
      root.classList.add('dark');
    }

    // Set CSS variables
    Object.entries(theme.colors).forEach(([key, value]) => {
      // Convert camelCase to kebab-case for CSS variables
      const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      root.style.setProperty(cssVar, value);
    });

    // Apply custom accent color if set, overriding the primary color
    if (theme.accentColor) {
      root.style.setProperty('--primary', theme.accentColor);
      root.style.setProperty('--ring', theme.accentColor);
      
      // Calculate luminance to determine if we need light or dark text
      const luminance = getLuminance(theme.accentColor);
      // Use dark text for light backgrounds (luminance > 0.5), light text for dark backgrounds
      const foregroundColor = luminance > 0.5 
        ? '222.2 84% 4.9%'  // Dark text for light accent colors
        : '210 40% 98%';     // Light text for dark accent colors
      
      root.style.setProperty('--primary-foreground', foregroundColor);
    } else {
      // Reset to theme defaults when no accent color is set
      root.style.setProperty('--primary', theme.colors.primary);
      root.style.setProperty('--primary-foreground', theme.colors.primaryForeground);
      root.style.setProperty('--ring', theme.colors.ring);
    }

    // Apply custom font family
    if (theme.fontFamily) {
      const fontVar = theme.fontFamily === 'inter' ? 'var(--font-inter)' 
                    : theme.fontFamily === 'geist' ? 'var(--font-geist)'
                    : theme.fontFamily === 'system' ? 'var(--font-system)'
                    : 'var(--font-inter)'; // default fallback
      root.style.setProperty('--font-sans', fontVar);
    } else {
      // Reset to Inter as default
      root.style.setProperty('--font-sans', 'var(--font-inter)');
    }
  }, [theme]);

  const value = {
    theme,
    setTheme,
    availableThemes: [defaultTheme, darkTheme],
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
