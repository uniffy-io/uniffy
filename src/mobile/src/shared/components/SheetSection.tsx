import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** A labelled group of chips inside a `BottomSheet`. */
export function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: T.textDim }]}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

/** Toggleable pill inside a `SheetSection`. */
export function SheetChip({
  label,
  tint,
  selected,
  onPress,
  showCheck = true,
  children,
}: {
  label: string;
  /** The colour the chip takes when selected; defaults to the theme accent. */
  tint?: string;
  selected: boolean;
  onPress: () => void;
  /** Off where the selection is already obvious from a single-choice group. */
  showCheck?: boolean;
  /** Leading slot - an avatar, a status icon. */
  children?: React.ReactNode;
}) {
  const T = useTheme();
  const color = tint || T.accent;

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: selected ? color + "22" : T.pageBg,
          borderColor: selected ? color : T.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {children}
      <Text style={[styles.chipText, { color: selected ? color : T.text }]} numberOfLines={1}>
        {label}
      </Text>
      {selected && showCheck && <Check size={12} color={color} weight="bold" />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipText: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
});
