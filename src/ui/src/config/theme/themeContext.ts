import { createContext, useContext } from "react";
import type { Theme } from "@/config/theme/types";
import type { ThemeMode } from "@/config/theme/themeSlice";

export interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  /** Resolves 'system' to the OS preference. */
  resolvedTheme: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
  availableModes: ThemeMode[];
}

// Lives apart from ThemeProvider so a hot reload of the provider module never
// re-creates the context the mounted provider serves.
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
