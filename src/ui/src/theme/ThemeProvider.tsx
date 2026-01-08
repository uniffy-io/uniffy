import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Theme } from './types';
import { defaultTheme, darkTheme } from './types';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  availableThemes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  // Apply theme variables to root
  useEffect(() => {
    const root = window.document.documentElement;
    
    // Remove old classes if using class-based (we are using variables, but good to reset)
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
