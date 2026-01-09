import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { defaultTheme } from './types';

interface ThemeState {
  currentTheme: string;
}

const initialState: ThemeState = {
  currentTheme: defaultTheme.name,
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
  },
});

export const { setThemeName, toggleTheme } = themeSlice.actions;

export default themeSlice.reducer;
