import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export interface SheetHeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `muted` reads as a secondary escape (Clear, Reset); `primary` commits. */
  tone?: "primary" | "muted";
}

/**
 * Title bar for a `BottomSheet`. Every sheet in the app wears the same one, so
 * a picker and an editor line their titles and actions up the same way.
 */
export function SheetHeader({
  title,
  actions,
  busy,
  accentColor,
}: {
  title: string;
  actions?: SheetHeaderAction[];
  busy?: boolean;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;

  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
      <View style={styles.actions}>
        {busy && <ActivityIndicator size="small" color={accent} />}
        {actions?.map((action) => (
          <TouchableOpacity
            key={action.label}
            onPress={action.onPress}
            disabled={action.disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                action.tone === "muted" ? styles.muted : styles.primary,
                {
                  color: action.disabled ? T.textDim : action.tone === "muted" ? T.textDim : accent,
                },
              ]}
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  primary: { fontSize: 15, fontFamily: FONT.semibold },
  muted: { fontSize: 14, fontFamily: FONT.regular },
});
