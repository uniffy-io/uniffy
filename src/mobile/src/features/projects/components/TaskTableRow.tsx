import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ArrowsClockwise, CheckCircle, CaretDown, CaretRight } from "phosphor-react-native";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { formatMinutes } from "@features/projects/timeFormatting";
import { TaskMetaChips, TaskDueDate } from "@features/projects/components/TaskMetaChips";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

const INDENT = 16;

/** One table row, at any depth of the outline. Primitives only, so the memo holds. */
export const TaskTableRow = React.memo(function TaskTableRow({
  task,
  depth,
  statusColor,
  statusOption,
  priorityOptions,
  accentColor,
  selecting,
  selected,
  blocked,
  parentKey,
  subtaskTotal,
  subtaskDone,
  outline,
  expanded,
  onPress,
  onToggleSelect,
  onToggleExpand,
  onOpenParent,
}: {
  task: SerializedTask;
  /** 0 for a row in its status group, 1 and deeper for subtasks shown under a parent. */
  depth: number;
  statusColor: string;
  /** Named on subtask rows, which the status group above does not describe. */
  statusOption?: PlainSelectOption;
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  selecting: boolean;
  selected: boolean;
  blocked: boolean;
  parentKey?: string | null;
  subtaskTotal: number;
  subtaskDone: number;
  /** Rows nest under their parents; off while a search or filter lists matches flat. */
  outline: boolean;
  /** Undefined when the row has nothing to expand. */
  expanded?: boolean;
  onPress: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  onOpenParent?: (parentId: string) => void;
}) {
  const T = useTheme();
  const isDone = !!task.completedAt;
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;
  const parentId = task.parentId;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        {
          backgroundColor: T.pageBg,
          borderBottomColor: T.border,
          borderLeftColor: statusColor,
          paddingLeft: INDENT + depth * INDENT,
        },
        selected && { backgroundColor: accentColor + "14" },
      ]}
      onPress={() => onPress(task.id)}
      activeOpacity={0.8}
    >
      {selecting && (
        <TouchableOpacity
          onPress={() => onToggleSelect(task.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {selected ? (
            <CheckCircle size={20} color={accentColor} weight="fill" />
          ) : (
            <View style={[styles.selectRing, { borderColor: T.textDim }]} />
          )}
        </TouchableOpacity>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          {outline &&
            (expanded === undefined ? (
              <View style={styles.caret} />
            ) : (
              <TouchableOpacity
                style={styles.caret}
                onPress={() => onToggleExpand(task.id)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={expanded ? "Hide subtasks" : "Show subtasks"}
              >
                {expanded ? (
                  <CaretDown size={12} color={T.textDim} weight="bold" />
                ) : (
                  <CaretRight size={12} color={T.textDim} weight="bold" />
                )}
              </TouchableOpacity>
            ))}
          <View style={styles.titleIcon}>
            <TypeIcon size={14} color={T.textDim} weight="duotone" />
          </View>
          <Text
            style={[
              styles.rowTitle,
              {
                color: isDone ? T.textDim : T.textBright,
                textDecorationLine: isDone ? "line-through" : "none",
              },
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          {task.recurrenceRule ? (
            <View style={styles.titleIcon}>
              <ArrowsClockwise size={12} color={T.textDim} weight="bold" />
            </View>
          ) : null}
        </View>
        <View style={styles.rowMeta}>
          <TaskMetaChips
            task={task}
            priorityOptions={priorityOptions}
            statusOption={statusOption}
            blocked={blocked}
            parentKey={parentKey}
            onOpenParent={
              parentId && onOpenParent && !selecting ? () => onOpenParent(parentId) : undefined
            }
          />
          {subtaskTotal > 0 && (
            <View style={styles.count}>
              <CheckCircle
                size={12}
                color={subtaskDone === subtaskTotal ? T.green : T.textDim}
                weight="duotone"
              />
              <Text style={[styles.rowMetaText, { color: T.textDim }]}>
                {subtaskDone}/{subtaskTotal}
              </Text>
            </View>
          )}
          {task.estimatedMinutes ? (
            <Text style={[styles.rowMetaText, { color: T.textDim }]}>
              {formatMinutes(task.estimatedMinutes)}
            </Text>
          ) : null}
          <TaskDueDate task={task} showIcon={false} />
        </View>
      </View>
      <SubjectAvatarStack subjectIds={task.assigneeIds} size={22} />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitleLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  // Centred on the first line rather than pinned to the top of it, so the icon
  // sits on the title instead of floating above it. The row stays flex-start so
  // a title that wraps still starts level with the icon.
  titleIcon: { height: 20, justifyContent: "center" },
  caret: { width: 14, height: 20, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontSize: 14, fontFamily: FONT.medium, lineHeight: 20 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowMetaText: { fontSize: 12, fontFamily: FONT.regular },
  count: { flexDirection: "row", alignItems: "center", gap: 3 },
  selectRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
});
