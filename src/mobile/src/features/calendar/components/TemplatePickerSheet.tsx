import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Copy } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useEventTemplates } from "@features/calendar/useCalendar";
import type { SerializedTemplate } from "@features/calendar/calendarSerializer";

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function TemplatePickerSheet({
  visible,
  onClose,
  onApply,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (template: SerializedTemplate) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const templates = useEventTemplates();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Use a template" accentColor={accent} />
      <ScrollView style={{ maxHeight: 360 }}>
        {templates.data?.map((template) => (
          <SheetRow
            key={template.id}
            title={template.title}
            subtitle={
              [durationLabel(template.durationMinutes), template.location]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            leading={<Copy size={18} color={accent} weight="duotone" />}
            onPress={() => {
              onApply(template);
              onClose();
            }}
          />
        ))}
        {templates.isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        )}
        {!templates.isLoading && (templates.data?.length ?? 0) === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>No templates yet</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 16, alignItems: "center" },
  empty: {
    fontSize: 14,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
  },
});
