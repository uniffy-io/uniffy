import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Plus, CheckCircle } from "phosphor-react-native";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { TaskMetaChips, TaskDueDate } from "@features/projects/components/TaskMetaChips";
import { DraggableTask } from "@features/projects/components/DraggableTask";
import { DragShift } from "@features/projects/components/DragShift";
import { isTaskBlocked, parentKeyOf } from "@features/projects/taskRelations";
import type { TaskDragController } from "@features/projects/useTaskDrag";
import type { TaskRelations } from "@features/projects/taskRelations";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

/** Also the distance a card slides when the one next to it is lifted away. */
export const CARD_GAP = 10;

export interface BoardColumn {
  key: string;
  label: string;
  color: string;
}

/** Primitives only, so the memo holds while the rest of the board changes. */
const TaskCard = React.memo(function TaskCard({
  task,
  subtaskTotal,
  subtasksDone,
  blocked,
  parentKey,
  priorityOptions,
  selecting,
  selected,
  selectionColor,
  onPress,
  onToggleSelect,
  onOpenParent,
}: {
  task: SerializedTask;
  subtaskTotal: number;
  subtasksDone: number;
  blocked: boolean;
  parentKey: string | null;
  priorityOptions: PlainSelectOption[];
  selecting: boolean;
  selected: boolean;
  selectionColor: string;
  onPress: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onOpenParent: (parentId: string) => void;
}) {
  const T = useTheme();
  const isDone = !!task.completedAt;
  const parentId = task.parentId;
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        { backgroundColor: T.bg, borderColor: T.border, opacity: isDone ? 0.7 : 1 },
        selected && { borderColor: selectionColor, backgroundColor: selectionColor + "14" },
      ]}
      onPress={() => onPress(task.id)}
      activeOpacity={0.8}
    >
      <View style={styles.taskTitleRow}>
        {selecting ? (
          <TouchableOpacity
            style={styles.titleIcon}
            onPress={() => onToggleSelect(task.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {selected ? (
              <CheckCircle size={18} color={selectionColor} weight="fill" />
            ) : (
              <View style={[styles.selectRing, { borderColor: T.textDim }]} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.titleIcon}>
            <TypeIcon size={13} color={T.textDim} weight="duotone" />
          </View>
        )}
        <Text
          style={[
            styles.taskTitle,
            { color: T.textBright, textDecorationLine: isDone ? "line-through" : "none" },
          ]}
        >
          {task.title}
        </Text>
      </View>

      {/* Under the title, matching the table row: the name is what identifies
          the card, the badges qualify it. */}
      {(task.priority || blocked || parentKey || task.tags.length > 0) && (
        <View style={styles.taskTags}>
          <TaskMetaChips
            task={task}
            priorityOptions={priorityOptions}
            blocked={blocked}
            parentKey={parentKey}
            onOpenParent={parentId && !selecting ? () => onOpenParent(parentId) : undefined}
          />
        </View>
      )}

      <View style={styles.taskFooter}>
        <View style={styles.taskFooterLeft}>
          <TaskDueDate task={task} />
          {subtaskTotal > 0 && (
            <Text style={[styles.subtaskCount, { color: T.textDim }]}>
              {subtasksDone}/{subtaskTotal}
            </Text>
          )}
        </View>
        <SubjectAvatarStack subjectIds={task.assigneeIds} size={20} />
      </View>
    </TouchableOpacity>
  );
});

/** Every visible task, subtasks included, as a card in its status column. */
export function ProjectBoardView({
  columns,
  relations,
  projectSlug,
  tasksFor,
  priorityOptions,
  accentColor,
  bottomPad,
  selecting,
  selectedIds,
  drag,
  overlay,
  onOpen,
  onToggleSelect,
  onToggleGroup,
  onOpenParent,
  onAddTask,
}: {
  columns: BoardColumn[];
  /** Built from every loaded task, not just the visible ones. */
  relations: TaskRelations;
  projectSlug: string;
  tasksFor: (statusId: string) => SerializedTask[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  bottomPad: number;
  selecting: boolean;
  selectedIds: string[];
  drag: TaskDragController;
  /** Drawn over the board in the drag layer's own coordinate space. */
  overlay?: React.ReactNode;
  onOpen: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onToggleGroup: (statusId: string) => void;
  onOpenParent: (parentId: string) => void;
  onAddTask: (statusId: string) => void;
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
        <ScrollView
          horizontal
          {...drag.horizontalScrollProps}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.boardContent}
          keyboardShouldPersistTaps="handled"
        >
          {columns.map((col) => {
            const colTasks = tasksFor(col.key);
            return (
              <View
                key={col.key}
                onLayout={(event) => drag.registerGroup(col.key, event)}
                style={[styles.column, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <TouchableOpacity
                  style={styles.colHeader}
                  activeOpacity={0.7}
                  onPress={() => onToggleGroup(col.key)}
                  disabled={colTasks.length === 0}
                >
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.colTitle, { color: T.textBright }]}>{col.label}</Text>
                  <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                    <Text style={[styles.colCountText, { color: T.textDim }]}>
                      {colTasks.length}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.cardList} onLayout={(e) => drag.registerList(col.key, e)}>
                  {colTasks.map((task, index) => {
                    const counts = relations.subtaskCounts.get(task.id);
                    return (
                      <DraggableTask
                        key={task.id}
                        gesture={drag.gestureFor(task.id)}
                        offset={drag.offsetFor(col.key, index)}
                        animate={dragging}
                        lifted={drag.draggingId === task.id}
                        onLayout={(event) => drag.registerItem(col.key, task.id, event)}
                        onUnmount={() => drag.unregisterItem(task.id)}
                      >
                        <TaskCard
                          task={task}
                          subtaskTotal={counts?.total ?? 0}
                          subtasksDone={counts?.done ?? 0}
                          blocked={isTaskBlocked(task, relations.byId)}
                          parentKey={parentKeyOf(task, relations.byId, projectSlug)}
                          priorityOptions={priorityOptions}
                          selecting={selecting}
                          selected={selectedIds.includes(task.id)}
                          selectionColor={accentColor}
                          onPress={onOpen}
                          onToggleSelect={onToggleSelect}
                          onOpenParent={onOpenParent}
                        />
                      </DraggableTask>
                    );
                  })}
                </View>

                <DragShift offset={drag.tailOffsetFor(col.key)} animate={dragging}>
                  <TouchableOpacity
                    style={[styles.addTaskBtn, { borderColor: T.border }]}
                    activeOpacity={0.7}
                    onPress={() => onAddTask(col.key)}
                  >
                    <Plus size={14} color={T.textDim} weight="bold" />
                    <Text style={[styles.addTaskText, { color: T.textDim }]}>Add task</Text>
                  </TouchableOpacity>
                </DragShift>
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  boardContent: { padding: 16, gap: 12 },
  column: {
    width: 260,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  colHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 },
  colDot: { width: 7, height: 7, borderRadius: 4 },
  colTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  colCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  colCountText: { fontSize: 11, fontFamily: FONT.medium },
  selectRing: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
  cardList: { gap: CARD_GAP },
  taskCard: {
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskTags: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: { fontSize: 10, fontFamily: FONT.medium },
  taskTitle: { flex: 1, fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  taskTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  // Centred on the first line rather than pinned to the top of it, so the icon
  // sits on the title instead of floating above it. The row stays flex-start so
  // a title that wraps still starts level with the icon.
  titleIcon: { height: 19, justifyContent: "center" },
  taskFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  taskFooterLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dueDateRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  dueDateText: { fontSize: 11, fontFamily: FONT.regular },
  subtaskCount: { fontSize: 11, fontFamily: FONT.medium },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addTaskText: { fontSize: 13, fontFamily: FONT.regular },
});
