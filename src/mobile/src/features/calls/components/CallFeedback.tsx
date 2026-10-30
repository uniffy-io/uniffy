import { useEffect } from "react";
import { AccessibilityInfo, View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCall } from "@features/calls/CallContext";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function CallFeedback() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { feedback: message, clearFeedback } = useCall();
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!message) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View
        accessibilityLiveRegion="polite"
        style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}
      >
        <Text style={[styles.message, { color: T.text }]}>{message}</Text>
        <View style={styles.actions}>
          {/settings/i.test(message) && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open app settings"
              style={styles.button}
              onPress={() => void Linking.openSettings().catch(() => {})}
            >
              <Text style={[styles.action, { color: T.accent }]}>Open settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Dismiss call message"
            style={styles.button}
            onPress={clearFeedback}
          >
            <Text style={[styles.action, { color: T.accent }]}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No zIndex: sibling order in _layout stacks the banner, and zIndex on an
  // inset-positioned view risks the iOS 26 Fabric flow-layout fallback.
  wrap: { position: "absolute", left: 14, right: 14, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 4,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  message: { fontSize: 14, fontFamily: FONT.regular, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  action: { fontSize: 14, fontFamily: FONT.medium },
});
