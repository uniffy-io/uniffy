import React from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** One switch line in a settings card: a label over a short explanation. */
export function ToggleRow({
  label,
  sub,
  value,
  onValueChange,
  border,
}: {
  label: string;
  sub: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  /** Hairline under the row; off for the last row in its card. */
  border?: boolean;
}) {
  const T = useTheme();
  return (
    <View
      style={[
        styles.row,
        border
          ? { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth }
          : null,
      ]}
    >
      <View style={styles.labels}>
        <Text style={[styles.label, { color: T.textBright }]}>{label}</Text>
        <Text style={[styles.sub, { color: T.textDim }]}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: T.accent, false: T.border }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  labels: { flex: 1 },
  label: { fontSize: 15, fontFamily: FONT.medium },
  sub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
});
