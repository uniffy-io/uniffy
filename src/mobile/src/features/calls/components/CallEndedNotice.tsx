import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { PhoneDisconnect } from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

import { CALL_END_COPY } from "@features/calls/callErrors";

export function CallEndedNotice() {
  const T = useTheme();
  const { endedInfo, clearEndedInfo, rejoin } = useCall();

  if (!endedInfo) return null;
  const canRejoin = endedInfo.cause === "CONNECTION_LOST" || endedInfo.cause === "NETWORK_LOST";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={clearEndedInfo}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          <PhoneDisconnect size={28} color={T.red} weight="duotone" />
          <Text accessibilityRole="alert" style={[styles.message, { color: T.textBright }]}>
            {CALL_END_COPY[endedInfo.cause]}
          </Text>
          <View style={styles.buttons}>
            {canRejoin ? (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: T.green }]}
                onPress={() => void rejoin()}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Rejoin call"
              >
                <Text style={styles.primaryLabel}>Rejoin</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: T.bg, borderColor: T.border, borderWidth: 1 },
              ]}
              onPress={clearEndedInfo}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={[styles.secondaryLabel, { color: T.text }]}>
                {canRejoin ? "Leave" : "OK"}
              </Text>
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
    alignItems: "center",
  },
  primaryLabel: { fontSize: 14, fontFamily: FONT.semibold, color: "#ffffff" },
  secondaryLabel: { fontSize: 14, fontFamily: FONT.medium },
});
