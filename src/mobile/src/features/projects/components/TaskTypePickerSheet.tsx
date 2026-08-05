import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { TASK_TYPES } from "@features/projects/taskTypes";

export function TaskTypePickerSheet({
  visible,
  onClose,
  selectedType,
  onSelect,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  selectedType: string;
  onSelect: (taskType: string) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>Task type</Text>
      </View>
      <ScrollView style={{ maxHeight: 400 }}>
        {TASK_TYPES.map(({ value, label, Icon, description }) => {
          const isSelected = selectedType === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.row, { borderBottomColor: T.border }]}
              onPress={() => {
                onSelect(value);
                onClose();
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconWrap, { backgroundColor: accent + "18" }]}>
                <Icon size={17} color={accent} weight="duotone" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: T.textBright }]}>{label}</Text>
                <Text style={[styles.description, { color: T.textDim }]}>{description}</Text>
              </View>
              {isSelected && <Check size={18} color={accent} weight="bold" />}
            </TouchableOpacity>
          );
        })}
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
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 15, fontFamily: FONT.medium },
  description: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
});
