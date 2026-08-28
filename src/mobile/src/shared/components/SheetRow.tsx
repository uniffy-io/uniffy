import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/**
 * One selectable line in a `BottomSheet` list: an optional leading slot, a
 * title over an optional subtitle, and a check when it is the current choice.
 */
export function SheetRow({
  leading,
  title,
  subtitle,
  muted,
  selected,
  trailing,
  accentColor,
  onPress,
}: {
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** For placeholder choices like "None" or "Backlog". */
  muted?: boolean;
  selected?: boolean;
  /** Sits between the label and the check - a status pill, a count. */
  trailing?: React.ReactNode;
  accentColor?: string;
  onPress: () => void;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      {leading}
      <View style={styles.labels}>
        <Text style={[styles.title, { color: muted ? T.textDim : T.textBright }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: T.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {selected && <Check size={18} color={accent} weight="bold" />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labels: { flex: 1 },
  title: { fontSize: 15, fontFamily: FONT.medium },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
});
