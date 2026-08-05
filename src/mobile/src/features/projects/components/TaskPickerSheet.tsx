import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Check, X } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
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
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
        {multi && (
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.done, { color: accent }]}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.searchBar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
        <TextInput
          style={[styles.searchInput, { color: T.textBright }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search tasks"
          placeholderTextColor={T.textDim}
          autoCorrect={false}
          returnKeyType="done"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery("")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={15} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        {allowNone && (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: T.border }]}
            onPress={() => choose(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.rowTitle, { color: T.textDim, flex: 1 }]}>None</Text>
            {selectedIds.length === 0 && <Check size={18} color={accent} weight="bold" />}
          </TouchableOpacity>
        )}

        {results.map((task) => {
          const { Icon, label } = getTaskTypeConfig(task.taskType);
          const isSelected = selectedIds.includes(task.id);
          return (
            <TouchableOpacity
              key={task.id}
              style={[styles.row, { borderBottomColor: T.border }]}
              onPress={() => choose(task.id)}
              activeOpacity={0.7}
            >
              <Icon size={16} color={T.textDim} weight="duotone" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: T.textBright }]} numberOfLines={1}>
                  {task.title}
                </Text>
                <Text style={[styles.rowMeta, { color: T.textDim }]}>
                  {label} - #{task.number}
                </Text>
              </View>
              {isSelected && <Check size={18} color={accent} weight="bold" />}
            </TouchableOpacity>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  done: { fontSize: 15, fontFamily: FONT.semibold },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 15, fontFamily: FONT.medium },
  rowMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 20 },
});
