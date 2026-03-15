import { useThemeContext } from "@/context/theme-context";
import type { ThemeColors } from "@/constants/theme";

export function useTheme(): ThemeColors & { isDark: boolean } {
  return useThemeContext().colors;
}
