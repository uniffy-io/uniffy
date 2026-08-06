import React, { useMemo, useState } from "react";
import { Text, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import type { SerializedTask } from "@features/projects/projectsSerializer";

/**
 * Picks other tasks in the same project - one for a parent, many for blockers.
 * `excludeIds` keeps a task from selecting itself; for a parent it should also
 * carry the task's descendants, since re-parenting onto one would cycle.
 */
export function TaskPickerSheet({
  visible,
  onClose,
  title,
  tasks,
  excludeIds,
  selectedIds,
  onToggle,
  multi = false,
  allowNone = false,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  tasks: SerializedTask[];
  excludeIds: string[];
  selectedIds: string[];
  onToggle: (taskId: string | null) => void;
  multi?: boolean;
  allowNone?: boolean;
  accentColor?: string;
}) {
  const T = useTheme();
  const [query, setQuery] = useState("");
  const accent = accentColor || T.accent;

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return tasks
      .filter((t) => !excludeIds.includes(t.id))
      .filter(
        (t) =>
          !trimmed || t.title.toLowerCase().includes(trimmed) || `${t.number}`.includes(trimmed),
      )
      .sort((a, b) => {
        const aSel = selectedIds.includes(a.id) ? 0 : 1;
        const bSel = selectedIds.includes(b.id) ? 0 : 1;
        return aSel - bSel || a.title.localeCompare(b.title);
      });
  }, [tasks, excludeIds, query, selectedIds]);

  const choose = (taskId: string | null) => {
    onToggle(taskId);
    if (!multi) onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={title}
        accentColor={accent}
        actions={multi ? [{ label: "Done", onPress: onClose }] : undefined}
      />

      <SheetSearchBar value={query} onChangeText={setQuery} placeholder="Search tasks" />

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        {allowNone && (
          <SheetRow
            title="None"
            muted
            selected={selectedIds.length === 0}
            accentColor={accent}
            onPress={() => choose(null)}
          />
        )}

        {results.map((task) => {
          const { Icon, label } = getTaskTypeConfig(task.taskType);
          return (
            <SheetRow
              key={task.id}
              title={task.title}
              subtitle={`${label} - #${task.number}`}
              leading={<Icon size={16} color={T.textDim} weight="duotone" />}
              selected={selectedIds.includes(task.id)}
              accentColor={accent}
              onPress={() => choose(task.id)}
            />
          );
        })}

        {results.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>No matching tasks</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
