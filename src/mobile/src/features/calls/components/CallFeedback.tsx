import { useEffect } from "react";
import { AccessibilityInfo, View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function CallFeedback({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: T.surface, bottom: insets.bottom + 12 }]}
    >
      <Text style={{ color: T.text, fontFamily: FONT.regular }}>{message}</Text>
      <View style={styles.actions}>
        {/settings/i.test(message) && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open app settings"
            style={styles.button}
            onPress={() => void Linking.openSettings().catch(() => {})}
          >
            <Text style={{ color: T.accent }}>Open settings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Dismiss call message"
          style={styles.button}
          onPress={onDismiss}
        >
          <Text style={{ color: T.accent }}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
    borderRadius: 12,
    padding: 16,
    elevation: 10,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
});
