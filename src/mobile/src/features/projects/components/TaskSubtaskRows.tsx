import React from "react";
import { useTheme } from "@shared/hooks/useTheme";
import { getOptionById } from "@features/projects/projectsSerializer";
import { TaskTableRow } from "@features/projects/components/TaskTableRow";
import { isTaskBlocked } from "@features/projects/taskRelations";
import type { TaskRelations } from "@features/projects/taskRelations";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";

/** Matches the web outline: subtasks nest five levels under a top-level task. */
export const MAX_SUBTASK_DEPTH = 5;

/**
 * The expanded subtasks of one table row, each with its own status since the
 * group above names only the parent's. Renders itself again for any child that
 * is expanded too.
 */
export function TaskSubtaskRows({
  parentId,
  depth,
  relations,
  statusOptions,
  priorityOptions,
  accentColor,
  selecting,
  selectedIds,
  expanded,
  onOpen,
  onToggleSelect,
  onToggleExpand,
}: {
  parentId: string;
  depth: number;
  relations: TaskRelations;
  statusOptions: PlainSelectOption[];
  priorityOptions: PlainSelectOption[];
  accentColor: string;
  selecting: boolean;
  selectedIds: string[];
  expanded: string[];
  onOpen: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
}) {
  const T = useTheme();
  const children = relations.childrenByParent.get(parentId) ?? [];

  return (
    <>
      {children.map((child) => {
        const status = getOptionById(statusOptions, child.status);
        const counts = relations.subtaskCounts.get(child.id);
        const canExpand = depth < MAX_SUBTASK_DEPTH && !!counts;
        const isExpanded = canExpand && expanded.includes(child.id);
        return (
          <React.Fragment key={child.id}>
            <TaskTableRow
              task={child}
              depth={depth}
              statusColor={status?.color ?? T.border}
              statusOption={status}
              priorityOptions={priorityOptions}
              accentColor={accentColor}
              selecting={selecting}
              selected={selectedIds.includes(child.id)}
              blocked={isTaskBlocked(child, relations.byId)}
              subtaskTotal={counts?.total ?? 0}
              subtaskDone={counts?.done ?? 0}
              outline
              expanded={canExpand ? isExpanded : undefined}
              onPress={onOpen}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
            {isExpanded && (
              <TaskSubtaskRows
                parentId={child.id}
                depth={depth + 1}
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
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
