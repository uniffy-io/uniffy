import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { WarningCircle } from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// A sheet is its own Modal window, so the shell's CallFeedback banner draws
// underneath it while it is open. Sheets that run call actions repeat the
// message inline; CallFeedback still announces it and takes over once the
// sheet closes.
export function CallSheetFeedback() {
  const T = useTheme();
  const { feedback, clearFeedback } = useCall();
  if (!feedback) return null;
  return (
    <View style={[styles.row, { borderColor: T.border, backgroundColor: T.bg }]}>
      <WarningCircle size={16} color={T.red} weight="fill" />
      <Text style={[styles.message, { color: T.text }]}>{feedback}</Text>
      <TouchableOpacity
        onPress={clearFeedback}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss call message"
      >
        <Text style={[styles.dismiss, { color: T.accent }]}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  message: { flex: 1, fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  dismiss: { fontSize: 13, fontFamily: FONT.semibold },
});
