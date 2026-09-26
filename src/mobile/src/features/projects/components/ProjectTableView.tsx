import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Plus, CaretDown, CaretRight } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { DraggableTask } from "@features/projects/components/DraggableTask";
import { DragShift } from "@features/projects/components/DragShift";
import { TaskTableRow } from "@features/projects/components/TaskTableRow";
import { TaskSubtaskRows } from "@features/projects/components/TaskSubtaskRows";
import { isTaskBlocked, parentKeyOf } from "@features/projects/taskRelations";
import type { TaskDragController } from "@features/projects/useTaskDrag";
import type { TaskGroup } from "@features/projects/taskGrouping";
import type { TaskRelations } from "@features/projects/taskRelations";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

export function ProjectTableView({
  groups,
  statusColorOf,
  relations,
  projectSlug,
  statusOptions,
  priorityOptions,
  accentColor,
  bottomPad,
  narrowed,
  outline,
  noMatches,
  selecting,
  selectedIds,
  collapsed,
  expanded,
  drag,
  overlay,
  onOpen,
  onOpenParent,
  onToggleSelect,
  onToggleGroup,
  onToggleCollapsed,
  onToggleExpand,
  onAddTask,
}: {
  groups: TaskGroup[];
  statusColorOf: (task: SerializedTask) => string;
  /** Built from every loaded task, not just the visible ones. */
  relations: TaskRelations;
  projectSlug: string;
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  bottomPad: number;
  narrowed: boolean;
  outline: boolean;
  noMatches: boolean;
  selecting: boolean;
  selectedIds: string[];
  /** Group keys whose rows are folded away. */
  collapsed: string[];
  /** Task ids whose subtasks are shown. */
  expanded: string[];
  drag: TaskDragController;
  /** Drawn over the list in the drag layer's own coordinate space. */
  overlay?: React.ReactNode;
  onOpen: (taskId: string) => void;
  onOpenParent: (parentId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onToggleGroup: (groupKey: string) => void;
  onToggleCollapsed: (groupKey: string) => void;
  onToggleExpand: (taskId: string) => void;
  onAddTask: () => void;
}) {
  const T = useTheme();
  const dragging = drag.draggingId !== null;
  // A task listed under several groups (two assignees, two tags) registers only its first row:
  // the drag layer keys rows by task id, and those groupings never drag anyway.
  const firstGroupOf = new Map<string, string>();
  for (const group of groups) {
    for (const task of group.tasks)
      if (!firstGroupOf.has(task.id)) firstGroupOf.set(task.id, group.key);
  }

  return (
    <View style={styles.fill} {...drag.containerProps}>
      <ScrollView
        {...drag.verticalScrollProps}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map((col) => {
          const colTasks = col.tasks;
          // A group that takes drops keeps its header even with nothing in it -
          // a status you cannot drop into is a status you can never move the
          // last task back out of. Search results are the one exception: there
          // an empty group is just noise.
          if (colTasks.length === 0 && narrowed) return null;
          const isCollapsed = collapsed.includes(col.key);

          return (
            <DragShift
              key={col.key}
              offset={drag.groupOffsetFor(col.key)}
              animate={dragging}
              onLayout={(event) => drag.registerGroup(col.key, event)}
              onUnmount={() => {
                drag.unregisterGroup(col.key);
                drag.unregisterList(col.key);
              }}
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
                <View style={[styles.colDot, { backgroundColor: col.color ?? T.textDim }]} />
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
                  : colTasks.map((task, index) => {
                      const counts = relations.subtaskCounts.get(task.id);
                      const canExpand = outline && !!counts;
                      const isExpanded = canExpand && expanded.includes(task.id);
                      return (
                        <DraggableTask
                          key={task.id}
                          gesture={drag.gestureFor(task.id)}
                          offset={drag.offsetFor(col.key, index)}
                          animate={dragging}
                          lifted={drag.draggingId === task.id}
                          onLayout={(event) => {
                            if (firstGroupOf.get(task.id) === col.key) {
                              drag.registerItem(col.key, task.id, event);
                            }
                          }}
                          onUnmount={() => {
                            if (firstGroupOf.get(task.id) === col.key) drag.unregisterItem(task.id);
                          }}
                          trailing={
                            isExpanded ? (
                              <TaskSubtaskRows
                                parentId={task.id}
                                depth={1}
                                relations={relations}
                                statusOptions={statusOptions}
                                priorityOptions={priorityOptions}
                                accentColor={accentColor}
                                selecting={selecting}
                                selectedIds={selectedIds}
                                expanded={expanded}
                                onOpen={onOpen}
                                onToggleSelect={onToggleSelect}
                                onToggleExpand={onToggleExpand}
                              />
                            ) : null
                          }
                        >
                          <TaskTableRow
                            task={task}
                            depth={0}
                            statusColor={statusColorOf(task)}
                            priorityOptions={priorityOptions}
                            accentColor={accentColor}
                            selecting={selecting}
                            selected={selectedIds.includes(task.id)}
                            blocked={isTaskBlocked(task, relations.byId)}
                            parentKey={
                              outline ? null : parentKeyOf(task, relations.byId, projectSlug)
                            }
                            subtaskTotal={counts?.total ?? 0}
                            subtaskDone={counts?.done ?? 0}
                            outline={outline}
                            expanded={canExpand ? isExpanded : undefined}
                            onPress={onOpen}
                            onToggleSelect={onToggleSelect}
                            onToggleExpand={onToggleExpand}
                            onOpenParent={onOpenParent}
                          />
                        </DraggableTask>
                      );
                    })}
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
