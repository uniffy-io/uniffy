import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { defaultTheme } from './types';

interface ThemeState {
  currentTheme: string;
  accentColor: string | null;
}

const initialState: ThemeState = {
  currentTheme: defaultTheme.name,
  accentColor: null,
};

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeName: (state, action: PayloadAction<string>) => {
      state.currentTheme = action.payload;
    },
    toggleTheme: (state) => {
      state.currentTheme = state.currentTheme === 'dark' ? 'default' : 'dark';
    },
    setAccentColor: (state, action: PayloadAction<string | null>) => {
      state.accentColor = action.payload;
    },
  },
});

export const { setThemeName, toggleTheme, setAccentColor } = themeSlice.actions;

export default themeSlice.reducer;
