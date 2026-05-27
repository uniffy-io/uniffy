import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  themeMode: ThemeMode;
  accentColor: string | null;
  /** 'inter' | 'geist' | 'system' | null (null = Inter). */
  fontFamily: string | null;
}

const initialState: ThemeState = {
  themeMode: 'system',
  accentColor: null,
  fontFamily: null,
};

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeMode: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
    },
    toggleTheme: (state) => {
      // Cycle: system -> light -> dark -> system
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
