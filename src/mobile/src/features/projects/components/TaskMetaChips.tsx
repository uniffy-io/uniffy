import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Warning, CalendarBlank } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { formatDateShort } from "@shared/lib/dateFormatting";
import { isTaskOverdue } from "@features/projects/taskFilters";
import { TaskPriorityBadge } from "@features/projects/components/TaskPriorityBadge";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

/**
 * The qualifying badges every task row carries under its title: priority, a
 * blocked marker, and the task's tags. Kept in one place so the board card, the
 * table row and the backlog row cannot drift apart.
 */
export function TaskMetaChips({
  task,
  priorityOptions,
  statusOption,
}: {
  task: SerializedTask;
  priorityOptions: PlainSelectOption[];
  /** The backlog row also names the status, since it has no column to imply it. */
  statusOption?: PlainSelectOption;
}) {
  const T = useTheme();
  const isBlocked = task.blockedByTaskIds.length > 0;

  if (!task.priority && !isBlocked && task.tags.length === 0 && !statusOption) return null;

  return (
    <>
      {task.priority ? (
        <TaskPriorityBadge priority={task.priority} options={priorityOptions} />
      ) : null}
      {statusOption && (
        <View style={[styles.chip, { backgroundColor: statusOption.color + "18" }]}>
          <Text style={[styles.chipText, { color: statusOption.color }]}>{statusOption.label}</Text>
        </View>
      )}
      {isBlocked && (
        <View style={[styles.chip, { backgroundColor: T.red + "18" }]}>
          <Warning size={9} color={T.red} weight="bold" />
          <Text style={[styles.chipText, { color: T.red }]}>Blocked</Text>
        </View>
      )}
      {task.tags.map((tag) => (
        <View key={tag.id} style={[styles.chip, { backgroundColor: tag.color + "22" }]}>
          <Text style={[styles.chipText, { color: tag.color }]}>{tag.name}</Text>
        </View>
      ))}
    </>
  );
}

/**
 * A task's due date, reddened once it is past. Web does the same, and a raw
 * `2026-08-06` in a row was never the intended reading.
 */
export function TaskDueDate({
  task,
  showIcon = true,
  size = 11,
}: {
  task: SerializedTask;
  showIcon?: boolean;
  size?: number;
}) {
  const T = useTheme();
  if (!task.dueDate) return null;

  const overdue = isTaskOverdue(task.dueDate, task.completedAt);
  const color = overdue ? T.red : T.textDim;

  return (
    <View style={styles.dueRow}>
      {showIcon && <CalendarBlank size={size} color={color} weight="duotone" />}
      <Text style={[styles.dueText, { color, fontSize: size }]}>
        {formatDateShort(task.dueDate)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: { fontSize: 10, fontFamily: FONT.medium },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  dueText: { fontFamily: FONT.regular },
});
