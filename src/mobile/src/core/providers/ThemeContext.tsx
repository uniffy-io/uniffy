import React, { createContext, useContext, useEffect, useMemo, useCallback, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@core/providers/AuthContext";
import { settingsApi } from "@core/api/settingsApi";
import { buildAccentColors } from "@theme/colorUtils";
import { DARK, LIGHT, DEFAULT_ACCENT_HSL, ACCENT_PRESETS } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";

export type ThemeMode = "system" | "light" | "dark";

type ThemeContextValue = {
  colors: ThemeColors & { isDark: boolean };
  themeMode: ThemeMode;
  accentColorHsl: string | null;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (hsl: string | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_MODE_KEY = "uniffy_theme_mode";
const ACCENT_COLOR_KEY = "uniffy_accent_color";
const PROFILE_ID_KEY = "uniffy_settings_profile_id";

async function storeItem(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

async function loadItem(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

// Accents persist on the device and in the settings profile; values from
// retired preset palettes fall back to the brand default instead of pinning
// an off-brand color forever.
function isKnownAccent(hsl: string): boolean {
  return ACCENT_PRESETS.some((preset) => preset.hsl === hsl);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const { isAuthenticated } = useAuth();

  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [accentColorHsl, setAccentColorHslState] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  // Load cached preferences on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [cachedMode, cachedAccent, cachedProfileId] = await Promise.all([
        loadItem(THEME_MODE_KEY),
        loadItem(ACCENT_COLOR_KEY),
        loadItem(PROFILE_ID_KEY),
      ]);
      if (!mounted) return;
      if (cachedMode === "light" || cachedMode === "dark" || cachedMode === "system") {
        setThemeModeState(cachedMode);
      }
      if (cachedAccent && isKnownAccent(cachedAccent)) {
        setAccentColorHslState(cachedAccent);
      }
      if (cachedProfileId) {
        setProfileId(cachedProfileId);
      }
      setCacheLoaded(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch settings from backend when authenticated
  useEffect(() => {
    if (!isAuthenticated || !cacheLoaded) return;
    let mounted = true;

    (async () => {
      try {
        const response = await settingsApi.getEffectiveSettings();
        if (!mounted) return;

        const appearance = response.effectiveSettings?.appearance;
        const profile = response.profile;

        if (profile?.id) {
          setProfileId(profile.id);
          await storeItem(PROFILE_ID_KEY, profile.id);
        }

        if (appearance?.theme) {
          const mode = appearance.theme as ThemeMode;
          if (mode === "system" || mode === "light" || mode === "dark") {
            setThemeModeState(mode);
            await storeItem(THEME_MODE_KEY, mode);
          }
        }

        if (appearance?.accentColor && isKnownAccent(appearance.accentColor)) {
          setAccentColorHslState(appearance.accentColor);
          await storeItem(ACCENT_COLOR_KEY, appearance.accentColor);
        }
      } catch {
        // Settings fetch failed — use cached/default values
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, cacheLoaded]);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      storeItem(THEME_MODE_KEY, mode).catch(() => {});

      if (profileId) {
        settingsApi
          .updateProfile({
            profileId,
            appearance: { theme: mode },
          })
          .catch(() => {});
      }
    },
    [profileId],
  );

  const setAccentColor = useCallback(
    (hsl: string | null) => {
      setAccentColorHslState(hsl);
      if (hsl) {
        storeItem(ACCENT_COLOR_KEY, hsl).catch(() => {});
      } else {
        removeItem(ACCENT_COLOR_KEY).catch(() => {});
      }

      if (profileId) {
        settingsApi
          .updateProfile({
            profileId,
            appearance: { accentColor: hsl ?? DEFAULT_ACCENT_HSL },
          })
          .catch(() => {});
      }
    },
    [profileId],
  );

  const value = useMemo(() => {
    const resolvedIsDark =
      themeMode === "system" ? systemColorScheme === "dark" : themeMode === "dark";

    const base = resolvedIsDark ? DARK : LIGHT;
    const accentOverrides = buildAccentColors(accentColorHsl, resolvedIsDark);

    const colors: ThemeColors & { isDark: boolean } = {
      ...base,
      ...accentOverrides,
      isDark: resolvedIsDark,
    };

    return {
      colors,
      themeMode,
      accentColorHsl,
      setThemeMode,
      setAccentColor,
    };
  }, [themeMode, accentColorHsl, systemColorScheme, setThemeMode, setAccentColor]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
