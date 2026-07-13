import { useThemeContext } from "@core/providers/theme-context";
import type { ThemeColors } from "@theme/theme";

export function useTheme(): ThemeColors & { isDark: boolean } {
  return useThemeContext().colors;
}
