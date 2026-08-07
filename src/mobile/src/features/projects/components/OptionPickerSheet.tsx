import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
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
      <SheetHeader title={title} accentColor={accent} />
      <ScrollView style={{ maxHeight: 360 }}>
        {allowNone && (
          <SheetRow
            title="None"
            muted
            leading={<View style={[styles.dot, { backgroundColor: T.border }]} />}
            selected={!selectedId}
            accentColor={accent}
            onPress={() => choose("")}
          />
        )}
        {options.map((option) => (
          <SheetRow
            key={option.id}
            title={option.label}
            leading={<View style={[styles.dot, { backgroundColor: option.color }]} />}
            selected={selectedId === option.id}
            accentColor={accent}
            onPress={() => choose(option.id)}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6 },
});
