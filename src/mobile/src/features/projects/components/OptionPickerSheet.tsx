import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";

/** Single-select over a project's status or priority options. */
export function OptionPickerSheet({
  visible,
  onClose,
  title,
  options,
  selectedId,
  onSelect,
  allowNone = false,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: PlainSelectOption[];
  selectedId: string | undefined;
  onSelect: (optionId: string) => void;
  allowNone?: boolean;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;

  const choose = (optionId: string) => {
    onSelect(optionId);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
      </View>
      <ScrollView style={{ maxHeight: 360 }}>
        {allowNone && (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: T.border }]}
            onPress={() => choose("")}
            activeOpacity={0.7}
          >
            <View style={[styles.dot, { backgroundColor: T.border }]} />
            <Text style={[styles.rowText, { color: T.textDim }]}>None</Text>
            {!selectedId && <Check size={18} color={accent} weight="bold" />}
          </TouchableOpacity>
        )}
        {options.map((option) => (
          <TouchableOpacity
            key={option.id}
            style={[styles.row, { borderBottomColor: T.border }]}
            onPress={() => choose(option.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.dot, { backgroundColor: option.color }]} />
            <Text style={[styles.rowText, { color: T.textBright }]} numberOfLines={1}>
              {option.label}
            </Text>
            {selectedId === option.id && <Check size={18} color={accent} weight="bold" />}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerRow: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 16, fontFamily: FONT.bold },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowText: { fontSize: 15, fontFamily: FONT.medium, flex: 1 },
});
