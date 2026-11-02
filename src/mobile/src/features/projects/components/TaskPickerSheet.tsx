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
import { rankBlockerCandidates } from "@features/projects/blockerCandidates";

/**
 * Picks other tasks in the same project - one for a parent, many for blockers.
 * `excludeIds` keeps a task from selecting itself; for a parent it should also
 * carry the task's descendants, since re-parenting onto one would cycle.
 * `rankAgainst` groups the list by how related each task is to that task
 * (same parent, same epic, recently updated), the order blockers are found in.
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
  rankAgainst,
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
  rankAgainst?: SerializedTask;
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

  const sections = useMemo(() => {
    if (!rankAgainst) return [{ key: "all", label: null, tasks: results }];
    const selected = results.filter((t) => selectedIds.includes(t.id));
    const ranked = rankBlockerCandidates(rankAgainst, tasks, {
      query,
      excludeIds: [...excludeIds, ...selectedIds],
    });
    return [
      ...(selected.length > 0 ? [{ key: "selected", label: "Selected", tasks: selected }] : []),
      ...ranked,
    ];
  }, [rankAgainst, results, tasks, query, excludeIds, selectedIds]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const isEmpty = sections.every((section) => section.tasks.length === 0);

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

        {sections.map((section) => (
          <React.Fragment key={section.key}>
            {section.label && (
              <Text style={[styles.section, { color: T.textDim }]}>{section.label}</Text>
            )}
            {section.tasks.map((task) => {
              const { Icon, label } = getTaskTypeConfig(task.taskType);
              const parent = rankAgainst && task.parentId ? byId.get(task.parentId) : undefined;
              return (
                <SheetRow
                  key={task.id}
                  title={task.title}
                  subtitle={
                    parent
                      ? `${label} - #${task.number} - in ${parent.title}`
                      : `${label} - #${task.number}`
                  }
                  leading={<Icon size={16} color={T.textDim} weight="duotone" />}
                  selected={selectedIds.includes(task.id)}
                  accentColor={accent}
                  onPress={() => choose(task.id)}
                />
              );
            })}
          </React.Fragment>
        ))}

        {isEmpty && <Text style={[styles.empty, { color: T.textDim }]}>No matching tasks</Text>}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
  section: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
