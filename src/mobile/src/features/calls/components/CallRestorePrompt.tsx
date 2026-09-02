import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { Phone } from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// Shown on a cold start when the process was killed during a call that is still
// running. Rejoining comes back muted with the camera off, since the user has
// said nothing about what to publish this time.
export function CallRestorePrompt() {
  const T = useTheme();
  const { restorable, restoreCall, dismissRestore } = useCall();

  if (!restorable) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismissRestore}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          <Phone size={28} color={T.green} weight="duotone" />
          <Text style={[styles.message, { color: T.textBright }]}>
            A call you were in is still going
          </Text>
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: T.green }]}
              onPress={() => void restoreCall()}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Rejoin call"
            >
              <Text style={styles.primaryLabel}>Rejoin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: T.bg, borderColor: T.border }]}
              onPress={dismissRestore}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={[styles.secondaryLabel, { color: T.text }]}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 14,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  message: { fontSize: 15, fontFamily: FONT.medium, textAlign: "center" },
  buttons: { flexDirection: "row", gap: 10, marginTop: 4 },
  button: {
    minWidth: 110,
    borderRadius: 12,
    paddingVertical: 11,
    borderWidth: 1,
    alignItems: "center",
  },
  primaryLabel: { fontSize: 14, fontFamily: FONT.semibold, color: "#ffffff" },
  secondaryLabel: { fontSize: 14, fontFamily: FONT.medium },
});
