import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { SerializedSprint } from "@features/projects/projectsSerializer";

const STATUS_LABEL: Record<SerializedSprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

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

  const statusTint = (status: SerializedSprint["status"]) =>
    status === "active" ? T.green : status === "closed" ? T.textDim : T.blue;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>Sprint</Text>
      </View>
      <ScrollView style={{ maxHeight: 400 }}>
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: T.border }]}
          onPress={() => choose(null)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: T.textDim }]}>Backlog</Text>
            <Text style={[styles.meta, { color: T.textDim }]}>Not in any sprint</Text>
          </View>
          {!selectedId && <Check size={18} color={accent} weight="bold" />}
        </TouchableOpacity>

        {sprints.map((sprint) => (
          <TouchableOpacity
            key={sprint.id}
            style={[styles.row, { borderBottomColor: T.border }]}
            onPress={() => choose(sprint.id)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
                {sprint.name}
              </Text>
              <Text style={[styles.meta, { color: T.textDim }]} numberOfLines={1}>
                {sprint.completedTaskCount}/{sprint.taskCount} done
                {sprint.goal ? ` - ${sprint.goal}` : ""}
              </Text>
            </View>
            <View
              style={[styles.statusPill, { backgroundColor: statusTint(sprint.status) + "22" }]}
            >
              <Text style={[styles.statusText, { color: statusTint(sprint.status) }]}>
                {STATUS_LABEL[sprint.status]}
              </Text>
            </View>
            {selectedId === sprint.id && <Check size={18} color={accent} weight="bold" />}
          </TouchableOpacity>
        ))}

        {sprints.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>This project has no sprints yet.</Text>
        )}
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
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 15, fontFamily: FONT.medium },
  meta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  statusPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: FONT.semibold },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
