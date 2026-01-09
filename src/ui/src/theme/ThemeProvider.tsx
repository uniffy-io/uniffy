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

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const currentThemeName = useAppSelector((state) => state.theme.currentTheme);
  
  // Resolve the actual theme object from the name in Redux
  const theme = themes[currentThemeName] || defaultTheme;

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
