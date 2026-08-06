import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Check, CaretDown } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { SerializedSprint, SerializedTask } from "@features/projects/projectsSerializer";

const BACKLOG = "__backlog__";

/**
 * Closing a sprint has to say what happens to the work that did not make it.
 * Each unfinished task picks its own destination, defaulting to the backlog,
 * and only then is the sprint closed.
 */
export function SprintCompleteSheet({
  visible,
  onClose,
  sprint,
  incompleteTasks,
  plannedSprints,
  projectSlug,
  accentColor,
  busy,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  sprint: SerializedSprint;
  incompleteTasks: SerializedTask[];
  plannedSprints: SerializedSprint[];
  projectSlug: string;
  accentColor: string;
  busy: boolean;
  onConfirm: (moves: { taskId: string; sprintId: string | null }[]) => void;
}) {
  const T = useTheme();
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const close = () => {
    setDestinations({});
    setExpandedId(null);
    onClose();
  };

  const destinationLabel = (taskId: string) => {
    const value = destinations[taskId] ?? BACKLOG;
    if (value === BACKLOG) return "Backlog";
    return plannedSprints.find((s) => s.id === value)?.name ?? "Backlog";
  };

  const confirm = () => {
    onConfirm(
      incompleteTasks.map((task) => {
        const value = destinations[task.id] ?? BACKLOG;
        return { taskId: task.id, sprintId: value === BACKLOG ? null : value };
      }),
    );
  };

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: T.textBright }]}>Complete sprint</Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>
          {incompleteTasks.length === 0
            ? `Every task in "${sprint.name}" is done.`
            : plannedSprints.length === 0
              ? `${incompleteTasks.length} unfinished task${incompleteTasks.length === 1 ? "" : "s"} will move back to the backlog.`
              : `${incompleteTasks.length} unfinished task${incompleteTasks.length === 1 ? "" : "s"}. Choose where each one goes.`}
        </Text>
      </View>

      {incompleteTasks.length > 0 && (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {incompleteTasks.map((task) => {
            const expanded = expandedId === task.id;
            const selected = destinations[task.id] ?? BACKLOG;
            return (
              <View key={task.id} style={[styles.taskRow, { borderBottomColor: T.border }]}>
                <View style={styles.taskLine}>
                  <Text style={[styles.taskNumber, { color: T.textDim }]}>
                    {projectSlug}-{task.number}
                  </Text>
                  <Text style={[styles.taskTitle, { color: T.textBright }]} numberOfLines={1}>
                    {task.title}
                  </Text>
                  {plannedSprints.length > 0 ? (
                    <TouchableOpacity
                      style={[
                        styles.destChip,
                        { borderColor: T.border, backgroundColor: T.surface },
                      ]}
                      onPress={() => setExpandedId(expanded ? null : task.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.destText, { color: T.text }]} numberOfLines={1}>
                        {destinationLabel(task.id)}
                      </Text>
                      <CaretDown size={11} color={T.textDim} weight="bold" />
                    </TouchableOpacity>
                  ) : (
                    <Text style={[styles.destText, { color: T.textDim }]}>Backlog</Text>
                  )}
                </View>

                {expanded && (
                  <View style={styles.options}>
                    {[{ id: BACKLOG, name: "Backlog" }, ...plannedSprints].map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        style={styles.option}
                        activeOpacity={0.7}
                        onPress={() => {
                          setDestinations((prev) => ({ ...prev, [task.id]: option.id }));
                          setExpandedId(null);
                        }}
                      >
                        <Text style={[styles.optionText, { color: T.text }]} numberOfLines={1}>
                          {option.name}
                        </Text>
                        {selected === option.id && (
                          <Check size={15} color={accentColor} weight="bold" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: T.border }]}
          onPress={close}
          activeOpacity={0.7}
        >
          <Text style={[styles.cancelText, { color: T.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: accentColor }]}
          onPress={confirm}
          activeOpacity={0.8}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmText}>Complete sprint</Text>
          )}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 4 },
  title: { fontSize: 16, fontFamily: FONT.bold },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  list: { maxHeight: 340 },
  taskRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  taskLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  taskNumber: { fontSize: 11, fontFamily: FONT.medium },
  taskTitle: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
  destChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 130,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  destText: { fontSize: 12, fontFamily: FONT.medium },
  options: { paddingBottom: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 9,
  },
  optionText: { flex: 1, fontSize: 13, fontFamily: FONT.regular },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelText: { fontSize: 14, fontFamily: FONT.medium },
  confirmBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 10,
  },
  confirmText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
});
