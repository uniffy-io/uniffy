import { Stack } from "expo-router";
import { useTheme } from "@shared/hooks/useTheme";

export default function TabsLayout() {
  const T = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: T.pageBg },
      }}
    />
  );
}
