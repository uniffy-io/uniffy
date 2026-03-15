import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

// Theme mode options: 'system' follows OS preference, 'light' and 'dark' are explicit
export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  themeMode: ThemeMode; // Persisted theme mode (system/light/dark)
  accentColor: string | null; // Persisted accent color, synced with user profile
  fontFamily: string | null; // Persisted font family, synced with user profile ('inter', 'geist', 'system', or null for default)
}

const initialState: ThemeState = {
  themeMode: 'system', // Default to system preference
  accentColor: null,
  fontFamily: null, // defaults to Inter
};

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeMode: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
    },
    toggleTheme: (state) => {
      // Cycle through: system -> light -> dark -> system
      if (state.themeMode === 'system') {
        state.themeMode = 'light';
      } else if (state.themeMode === 'light') {
        state.themeMode = 'dark';
      } else {
        state.themeMode = 'system';
      }
    },
    setAccentColor: (state, action: PayloadAction<string | null>) => {
      state.accentColor = action.payload;
    },
    setFontFamily: (state, action: PayloadAction<string | null>) => {
      state.fontFamily = action.payload;
    },
  },
});

export const { setThemeMode, toggleTheme, setAccentColor, setFontFamily } = themeSlice.actions;

export const themeReducer = themeSlice.reducer;
