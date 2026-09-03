import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WarningCircle } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** What a list shows when its fetch fails; the empty state there would read as "you have none". */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const T = useTheme();
  return (
    <View style={styles.wrap}>
      <WarningCircle size={32} color={T.textDim} weight="duotone" />
      <Text style={[styles.message, { color: T.textDim }]}>
        This could not be loaded. Check your connection and try again.
      </Text>
      <TouchableOpacity
        style={[styles.retry, { backgroundColor: T.accent }]}
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
    paddingVertical: 32,
  },
  message: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, fontFamily: FONT.semibold, color: "#ffffff" },
});
