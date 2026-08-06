import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ArrowRight, ArrowsClockwise, CheckCircle, CalendarBlank } from "phosphor-react-native";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { getOptionById } from "@features/projects/projectsSerializer";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

export function BacklogTaskRow({
  task,
  projectSlug,
  statusOptions,
  priorityOptions,
  canMove,
  onPress,
  onMove,
}: {
  task: SerializedTask;
  projectSlug: string;
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  /** False when the project has nowhere else to put the task. */
  canMove: boolean;
  onPress: () => void;
  onMove: () => void;
}) {
  const T = useTheme();
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;
  const status = getOptionById(statusOptions, task.status);
  const priority = getOptionById(priorityOptions, task.priority);
  const isDone = !!task.completedAt;

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <TypeIcon size={13} color={T.textDim} weight="duotone" />
          <Text style={[styles.number, { color: T.textDim }]}>
            {projectSlug}-{task.number}
          </Text>
          <Text
            style={[
              styles.title,
              {
                color: isDone ? T.textDim : T.textBright,
                textDecorationLine: isDone ? "line-through" : "none",
              },
            ]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
          {task.recurrenceRule ? (
            <ArrowsClockwise size={11} color={T.textDim} weight="bold" />
          ) : null}
        </View>

        <View style={styles.metaLine}>
          {priority && (
            <View style={[styles.chip, { backgroundColor: priority.color + "18" }]}>
              <Text style={[styles.chipText, { color: priority.color }]}>{priority.label}</Text>
            </View>
          )}
          {status && (
            <View style={[styles.chip, { backgroundColor: status.color + "18" }]}>
              <Text style={[styles.chipText, { color: status.color }]}>{status.label}</Text>
            </View>
          )}
          {task.subtaskTotal > 0 && (
            <View style={styles.metaItem}>
              <CheckCircle
                size={11}
                color={task.subtaskCompleted === task.subtaskTotal ? T.green : T.textDim}
                weight="duotone"
              />
              <Text style={[styles.metaText, { color: T.textDim }]}>
                {task.subtaskCompleted}/{task.subtaskTotal}
              </Text>
            </View>
          )}
          {task.dueDate && (
            <View style={styles.metaItem}>
              <CalendarBlank size={11} color={T.textDim} weight="duotone" />
              <Text style={[styles.metaText, { color: T.textDim }]}>{task.dueDate}</Text>
            </View>
          )}
          <View style={styles.metaEnd}>
            <SubjectAvatarStack subjectIds={task.assigneeIds} size={18} max={2} />
          </View>
        </View>
      </View>

      {canMove && (
        <TouchableOpacity
          onPress={onMove}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.moveBtn}
        >
          <ArrowRight size={16} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 5 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  number: { fontSize: 11, fontFamily: FONT.medium },
  title: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaEnd: { marginLeft: "auto" },
  metaText: { fontSize: 11, fontFamily: FONT.regular },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  chipText: { fontSize: 10, fontFamily: FONT.medium },
  moveBtn: { padding: 4 },
});
