import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import {
  Plus,
  Warning,
  ArrowsClockwise,
  CheckCircle,
  CaretDown,
  CaretRight,
} from "phosphor-react-native";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { formatMinutes } from "@features/projects/timeFormatting";
import { TaskPriorityBadge } from "@features/projects/components/TaskPriorityBadge";
import { DraggableTask } from "@features/projects/components/DraggableTask";
import { DragShift } from "@features/projects/components/DragShift";
import type { BoardColumn } from "@features/projects/components/ProjectBoardView";
import type { TaskDragController } from "@features/projects/useTaskDrag";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

function TaskRow({
  task,
  statusColor,
  priorityOptions,
  accentColor,
  selecting,
  selected,
  onPress,
  onToggleSelect,
}: {
  task: SerializedTask;
  statusColor: string;
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onToggleSelect: () => void;
}) {
  const T = useTheme();
  const isDone = !!task.completedAt;
  const isBlocked = task.blockedByTaskIds.length > 0;
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: T.pageBg, borderBottomColor: T.border, borderLeftColor: statusColor },
        selected && { backgroundColor: accentColor + "14" },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {selecting && (
        <TouchableOpacity
          onPress={onToggleSelect}
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
          {task.priority ? (
            <TaskPriorityBadge priority={task.priority} options={priorityOptions} />
          ) : null}
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
          {task.estimatedMinutes ? (
            <Text style={[styles.rowMetaText, { color: T.textDim }]}>
              {formatMinutes(task.estimatedMinutes)}
            </Text>
          ) : null}
          {task.dueDate ? (
            <Text style={[styles.rowMetaText, { color: T.textDim }]}>{task.dueDate}</Text>
          ) : null}
        </View>
      </View>
      <SubjectAvatarStack subjectIds={task.assigneeIds} size={22} />
    </TouchableOpacity>
  );
}

export function ProjectTableView({
  columns,
  tasksFor,
  priorityOptions,
  accentColor,
  bottomPad,
  narrowed,
  noMatches,
  selecting,
  selectedIds,
  collapsed,
  drag,
  overlay,
  onOpen,
  onToggleSelect,
  onToggleGroup,
  onToggleCollapsed,
  onAddTask,
}: {
  columns: BoardColumn[];
  tasksFor: (statusId: string) => SerializedTask[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  bottomPad: number;
  narrowed: boolean;
  noMatches: boolean;
  selecting: boolean;
  selectedIds: string[];
  /** Status ids whose rows are folded away. */
  collapsed: string[];
  drag: TaskDragController;
  /** Drawn over the list in the drag layer's own coordinate space. */
  overlay?: React.ReactNode;
  onOpen: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onToggleGroup: (statusId: string) => void;
  onToggleCollapsed: (statusId: string) => void;
  onAddTask: () => void;
}) {
  const T = useTheme();
  const dragging = drag.draggingId !== null;

  return (
    <View style={styles.fill} {...drag.containerProps}>
      <ScrollView
        {...drag.verticalScrollProps}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
      >
        {columns.map((col) => {
          const colTasks = tasksFor(col.key);
          // Every status keeps its header so it stays a drop target even with
          // nothing in it - a status you cannot drop into is a status you can
          // never move the last task back out of. Search results are the one
          // exception: there an empty status is just noise.
          if (colTasks.length === 0 && narrowed) return null;
          const isCollapsed = collapsed.includes(col.key);

          return (
            <DragShift
              key={col.key}
              offset={drag.groupOffsetFor(col.key)}
              animate={dragging}
              onLayout={(event) => drag.registerGroup(col.key, event)}
            >
              {/* One header, two jobs: it folds the group away normally, and
                  takes the whole group once selection mode is on - which is the
                  only time taking a group is what the tap could have meant. */}
              <TouchableOpacity
                style={[styles.groupHeader, { backgroundColor: T.bg, borderBottomColor: T.border }]}
                activeOpacity={0.7}
                onPress={() => (selecting ? onToggleGroup(col.key) : onToggleCollapsed(col.key))}
                disabled={colTasks.length === 0}
              >
                {isCollapsed ? (
                  <CaretRight size={12} color={T.textDim} weight="bold" />
                ) : (
                  <CaretDown size={12} color={T.textDim} weight="bold" />
                )}
                <View style={[styles.colDot, { backgroundColor: col.color }]} />
                <Text style={[styles.groupTitle, { color: T.textBright }]}>{col.label}</Text>
                <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                  <Text style={[styles.colCountText, { color: T.textDim }]}>{colTasks.length}</Text>
                </View>
              </TouchableOpacity>

              {/* Rendered even when collapsed, so the group keeps registering a
                  list rect and stays a drop target with its rows folded away. */}
              <View onLayout={(event) => drag.registerList(col.key, event)}>
                {isCollapsed
                  ? null
                  : colTasks.map((task, index) => (
                      <DraggableTask
                        key={task.id}
                        gesture={drag.gestureFor(task.id)}
                        offset={drag.offsetFor(col.key, index)}
                        animate={dragging}
                        lifted={drag.draggingId === task.id}
                        onLayout={(event) => drag.registerItem(col.key, task.id, event)}
                      >
                        <TaskRow
                          task={task}
                          statusColor={col.color}
                          priorityOptions={priorityOptions}
                          accentColor={accentColor}
                          selecting={selecting}
                          selected={selectedIds.includes(task.id)}
                          onPress={() => onOpen(task.id)}
                          onToggleSelect={() => onToggleSelect(task.id)}
                        />
                      </DraggableTask>
                    ))}
              </View>
            </DragShift>
          );
        })}

        {noMatches ? (
          <Text style={[styles.noMatches, { color: T.textDim }]}>No tasks match this search</Text>
        ) : narrowed ? null : (
          // No shift: whatever a group above gives up, another takes, so the
          // end of the list never moves.
          <TouchableOpacity
            style={[styles.addBtn, { borderColor: T.border }]}
            activeOpacity={0.7}
            onPress={onAddTask}
          >
            <Plus size={15} color={T.textDim} weight="bold" />
            <Text style={[styles.addText, { color: T.textDim }]}>Add task</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  colDot: { width: 7, height: 7, borderRadius: 4 },
  colCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  colCountText: { fontSize: 11, fontFamily: FONT.medium },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
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
  rowTitle: { flex: 1, fontSize: 14, fontFamily: FONT.medium, lineHeight: 20 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowMetaText: { fontSize: 12, fontFamily: FONT.regular },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: { fontSize: 10, fontFamily: FONT.medium },
  selectRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  noMatches: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 32 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addText: { fontSize: 13, fontFamily: FONT.regular },
});
