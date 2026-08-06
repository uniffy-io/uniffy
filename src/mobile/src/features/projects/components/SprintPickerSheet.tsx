import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { SPRINT_STATUS_LABEL, sprintStatusTint } from "@features/projects/projectsSerializer";
import type { SerializedSprint } from "@features/projects/projectsSerializer";

export function SprintPickerSheet({
  visible,
  onClose,
  sprints,
  selectedId,
  onSelect,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  sprints: SerializedSprint[];
  selectedId: string | undefined;
  onSelect: (sprintId: string | null) => void;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;

  const choose = (sprintId: string | null) => {
    onSelect(sprintId);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Sprint" accentColor={accent} />
      <ScrollView style={{ maxHeight: 400 }}>
        <SheetRow
          title="Backlog"
          subtitle="Not in any sprint"
          muted
          selected={!selectedId}
          accentColor={accent}
          onPress={() => choose(null)}
        />

        {sprints.map((sprint) => {
          const tint = sprintStatusTint(T, sprint.status);
          return (
            <SheetRow
              key={sprint.id}
              title={sprint.name}
              subtitle={`${sprint.completedTaskCount}/${sprint.taskCount} done${
                sprint.goal ? ` - ${sprint.goal}` : ""
              }`}
              selected={selectedId === sprint.id}
              accentColor={accent}
              onPress={() => choose(sprint.id)}
              trailing={
                <View style={[styles.statusPill, { backgroundColor: tint + "22" }]}>
                  <Text style={[styles.statusText, { color: tint }]}>
                    {SPRINT_STATUS_LABEL[sprint.status]}
                  </Text>
                </View>
              }
            />
          );
        })}

        {sprints.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>This project has no sprints yet.</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  statusPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: FONT.semibold },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
