import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
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
      <SheetHeader title="Task type" accentColor={accent} />
      <ScrollView style={{ maxHeight: 400 }}>
        {TASK_TYPES.map(({ value, label, Icon, description }) => (
          <SheetRow
            key={value}
            title={label}
            subtitle={description}
            leading={
              <View style={[styles.iconWrap, { backgroundColor: accent + "18" }]}>
                <Icon size={17} color={accent} weight="duotone" />
              </View>
            }
            selected={selectedType === value}
            accentColor={accent}
            onPress={() => {
              onSelect(value);
              onClose();
            }}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
