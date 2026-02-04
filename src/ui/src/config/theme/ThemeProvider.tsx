import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { Theme } from '@/config/theme/types';
import { defaultTheme, darkTheme } from '@/config/theme/types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setThemeMode, setAccentColor, setFontFamily, type ThemeMode } from '@/config/theme/themeSlice';
import { updateEffectiveSettingsLocal, updateProfile } from '@/features/settings/store/settingsSlice';

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark'; // The actual theme being applied (resolves 'system')
  setTheme: (mode: ThemeMode) => void;
  availableModes: ThemeMode[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

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

/**
 * Get the system preference for dark/light mode
 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();

  // Read from theme slice (legacy/fallback)
  const themeSliceMode = useAppSelector((state) => state.theme?.themeMode);
  const themeSliceAccentColor = useAppSelector((state) => state.theme?.accentColor);
  const themeSliceFontFamily = useAppSelector((state) => state.theme?.fontFamily);

  // Read from settings store (new settings framework)
  const settingsInitialized = useAppSelector((state) => state.settings?.initialized);
  const effectiveSettings = useAppSelector((state) => state.settings?.effectiveSettings);
  const activeProfileId = useAppSelector((state) => state.settings?.activeProfileId);

  // Read from user profile (legacy fallback)
  const user = useAppSelector((state) => state.auth?.user);

  // Track system preference changes
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Determine final values with priority:
  // 1. Settings framework (if initialized)
  // 2. Theme slice (persisted local state)
  // 3. User profile (legacy)
  // 4. Defaults
  const themeMode: ThemeMode = useMemo(() => {
    if (settingsInitialized && effectiveSettings?.appearance.theme) {
      return effectiveSettings.appearance.theme as ThemeMode;
    }
    return themeSliceMode ?? 'system';
  }, [settingsInitialized, effectiveSettings?.appearance.theme, themeSliceMode]);

  const accentColor = useMemo(() => {
    if (settingsInitialized && effectiveSettings?.appearance.accentColor) {
      return effectiveSettings.appearance.accentColor;
    }
    return themeSliceAccentColor || user?.accentColor || null;
  }, [settingsInitialized, effectiveSettings, themeSliceAccentColor, user]);

  const fontFamily = useMemo(() => {
    if (settingsInitialized && effectiveSettings?.appearance.fontFamily) {
      return effectiveSettings.appearance.fontFamily;
    }
    return themeSliceFontFamily || user?.fontFamily || null;
  }, [settingsInitialized, effectiveSettings, themeSliceFontFamily, user]);

  // Sync settings to theme slice when settings change (for components using themeSlice directly)
  useEffect(() => {
    if (settingsInitialized && effectiveSettings) {
      const settingsTheme = effectiveSettings.appearance.theme as ThemeMode;
      const settingsAccent = effectiveSettings.appearance.accentColor || null;
      const settingsFont = effectiveSettings.appearance.fontFamily || null;

      if (settingsTheme && settingsTheme !== themeSliceMode) {
        dispatch(setThemeMode(settingsTheme));
      }
      if (settingsAccent !== themeSliceAccentColor) {
        dispatch(setAccentColor(settingsAccent));
      }
      if (settingsFont !== themeSliceFontFamily) {
        dispatch(setFontFamily(settingsFont));
      }
    }
  }, [settingsInitialized, effectiveSettings, dispatch, themeSliceMode, themeSliceAccentColor, themeSliceFontFamily]);

  // Legacy sync from user profile (only if settings not initialized)
  useEffect(() => {
    if (!settingsInitialized && user) {
      if (user.accentColor && user.accentColor !== themeSliceAccentColor) {
        dispatch(setAccentColor(user.accentColor));
      }
      if (user.fontFamily && user.fontFamily !== themeSliceFontFamily) {
        dispatch(setFontFamily(user.fontFamily));
      }
    }
  }, [settingsInitialized, user, themeSliceAccentColor, themeSliceFontFamily, dispatch]);

  // Resolve 'system' to actual theme
  const resolvedTheme: 'light' | 'dark' = themeMode === 'system' ? systemTheme : themeMode;

  // Get the theme colors based on resolved theme
  const baseTheme = resolvedTheme === 'dark' ? darkTheme : defaultTheme;

  const theme: Theme = useMemo(() => ({
    ...baseTheme,
    accentColor: accentColor || undefined,
    fontFamily: fontFamily || undefined,
  }), [baseTheme, accentColor, fontFamily]);

  const setTheme = useCallback((mode: ThemeMode) => {
    // Update theme slice (for persistence and immediate effect)
    dispatch(setThemeMode(mode));
    // Also update settings store if initialized (so computed themeMode updates)
    if (settingsInitialized) {
      dispatch(updateEffectiveSettingsLocal({ appearance: { theme: mode } }));
      // Persist to backend if we have an active profile
      if (activeProfileId) {
        dispatch(updateProfile({ profileId: activeProfileId, appearance: { theme: mode } }));
      }
    }
  }, [dispatch, settingsInitialized, activeProfileId]);

  // Apply theme variables to root
  useEffect(() => {
    const root = window.document.documentElement;

    // Remove old classes
    root.classList.remove('dark');

    if (resolvedTheme === 'dark') {
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
  }, [theme, resolvedTheme]);

  const availableModes = useMemo(() => ['system', 'light', 'dark'] as ThemeMode[], []);

  const value = useMemo(() => ({
    theme,
    themeMode,
    resolvedTheme,
    setTheme,
    availableModes,
  }), [theme, themeMode, resolvedTheme, setTheme, availableModes]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
