/**
 * BoardView - Kanban board view for tasks
 *
 * Features:
 * - Horizontal scroll container for columns
 * - Uses status field options as columns
 * - Drag-and-drop between columns
 * - Task filtering by search query
 */

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  selectCurrentProject,
  optimisticUpdateTask,
  updateFieldDefinition,
} from "@/features/projects/store/projectsSlice";
import { selectActiveSprint, selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { moveTask, updateFieldThunk, updateTask } from "@/features/projects/store/projectsThunks";
import { checkReparent } from "@/features/projects/utils/reparent";
import { getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import {
  selectSelectedTaskIds,
  selectSearchQuery,
  selectActiveGroupByFieldId,
  selectTask,
  toggleTaskSelection,
  openDetailPanel,
  openCreateTaskModal,
} from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { useSwimlaneCollapse } from "@/features/projects/hooks/useSwimlaneCollapse";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, SelectOption } from "@/features/projects/types";
import { GROUP_BY_EPIC_KEY } from "@/features/projects/components/header/ProjectHeader";
import { BoardColumn } from "./BoardColumn";
import { TaskCard } from "./TaskCard";
import { BoardSwimlane, SwimlaneStatusHeaderRow } from "./BoardSwimlane";
import { NO_EPIC_LANE_ID, parseSwimlaneDropId } from "./swimlaneDropId";
import { AddStatusDialog } from "./AddStatusDialog";
import { EmptyState } from "../table/EmptyState";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";

export function BoardView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const tasks = useFilteredTasks(project?.id ?? "", { includeSubtasks: true });
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const searchQuery = useAppSelector(selectSearchQuery);
  const groupBy = useAppSelector(selectActiveGroupByFieldId);
  const activeSprint = useAppSelector(selectActiveSprint(project?.id ?? ""));
  const allSprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));
  const hasSprints = allSprints.length > 0;
  const isSwimlaneMode = groupBy === GROUP_BY_EPIC_KEY;

  const { canEdit } = useProjectPermission();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddStatusOpen, setIsAddStatusOpen] = useState(false);
  const altHeldRef = useRef(false);
  const pointerYRef = useRef<number | null>(null);
  const [reparentHintActive, setReparentHintActive] = useState(false);
  const { isCollapsed, toggle: toggleLane } = useSwimlaneCollapse(project?.id ?? "");

  // Configure sensors for drag detection
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: canEdit ? 8 : Infinity,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  useEffect(() => {
    if (!activeTask) return;
    const sync = (held: boolean) => {
      altHeldRef.current = held;
      setReparentHintActive(held);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") sync(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") sync(false);
    };
    const onBlur = () => sync(false);
    const onPointerMove = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [activeTask]);

  if (!project) {
    return null;
  }

  // Get status field options (columns)
  const statusField = project.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS
  );
  const statusOptions = statusField?.config.options || [];

  // Get priority options for card badges
  const priorityField = project.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.PRIORITY
  );
  const priorityOptions = priorityField?.config.options || [];

  // Group tasks by status
  const tasksByStatus = statusOptions.reduce(
    (acc, option) => {
      acc[option.id] = tasks.filter((t) => t.status === option.id);
      return acc;
    },
    {} as Record<string, Task[]>
  );

  const epicTasks = isSwimlaneMode
    ? tasks
        .filter((t) => (t.taskType || "task") === "epic")
        .slice()
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.title.localeCompare(b.title);
        })
    : [];

  const taskIsEpic = (t: Task) => (t.taskType || "task") === "epic";
  const laneIdForTask = (t: Task): string => {
    if (!t.parentId) return NO_EPIC_LANE_ID;
    const parent = tasks.find((p) => p.id === t.parentId);
    return parent && taskIsEpic(parent) ? parent.id : NO_EPIC_LANE_ID;
  };

  const epicLanes = isSwimlaneMode
    ? epicTasks.map((epic) => {
        const laneTasks = tasks.filter((t) => t.parentId === epic.id && !taskIsEpic(t));
        const byStatus = statusOptions.reduce((acc, opt) => {
          acc[opt.id] = laneTasks.filter((t) => t.status === opt.id);
          return acc;
        }, {} as Record<string, Task[]>);
        return { laneId: epic.id, epic, tasksByStatus: byStatus };
      })
    : [];

  const noEpicTasks = isSwimlaneMode
    ? tasks.filter((t) => !taskIsEpic(t) && laneIdForTask(t) === NO_EPIC_LANE_ID)
    : [];
  const noEpicByStatus = isSwimlaneMode
    ? statusOptions.reduce((acc, opt) => {
        acc[opt.id] = noEpicTasks.filter((t) => t.status === opt.id);
        return acc;
      }, {} as Record<string, Task[]>)
    : {};

  // Status IDs that count toward "done" in lane progress badges.
  const doneStatusIds = new Set(
    statusOptions
      .filter((s) => s.id === "status_done" || s.label.toLowerCase().includes("done"))
      .map((s) => s.id),
  );

  const handleTaskClick = (taskId: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      dispatch(toggleTaskSelection(taskId));
    } else {
      dispatch(selectTask(taskId));
      dispatch(openDetailPanel());
    }
  };

  const handleCheckboxChange = (taskId: string) => {
    dispatch(toggleTaskSelection(taskId));
  };

  const handleAddTask = () => {
    dispatch(openCreateTaskModal());
  };

  const handleAddStatus = (label: string, color: string) => {
    if (!statusField) return;
    
    const existingOptions = statusField.config.options || [];
    const maxSortOrder = existingOptions.reduce((max, item) => Math.max(max, item.sortOrder), -1);

    const newOption: SelectOption = {
      id: `status_${crypto.randomUUID().slice(0, 8)}`,
      label,
      color,
      sortOrder: maxSortOrder + 1,
    };
    
    const updatedConfig = { ...statusField.config, options: [...existingOptions, newOption] };

    // Optimistic update
    dispatch(updateFieldDefinition({
      projectId: project.id,
      fieldId: SYSTEM_FIELD_IDS.STATUS,
      changes: { config: updatedConfig },
    }));

    // API update
    dispatch(updateFieldThunk({
      projectId: project.id,
      fieldId: SYSTEM_FIELD_IDS.STATUS,
      updates: { config: updatedConfig },
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const reorderWithinColumn = (
    taskId: string,
    task: Task,
    columnTasks: Task[],
    overTask: Task,
    overRect: { top: number; height: number },
    pointerY: number | null,
  ) => {
    const overIdx = columnTasks.findIndex((t) => t.id === overTask.id);
    if (overIdx === -1) return;

    const insertBefore =
      pointerY !== null
        ? (pointerY - overRect.top) / overRect.height < 0.5
        : columnTasks.findIndex((t) => t.id === taskId) > overIdx;
    const direction = insertBefore ? -1 : 1;
    let neighborIdx = overIdx + direction;
    while (
      neighborIdx >= 0 &&
      neighborIdx < columnTasks.length &&
      columnTasks[neighborIdx].id === taskId
    ) {
      neighborIdx += direction;
    }
    const neighbor =
      neighborIdx >= 0 && neighborIdx < columnTasks.length ? columnTasks[neighborIdx] : null;

    let newSortOrder: number;
    if (insertBefore) {
      newSortOrder = neighbor
        ? (neighbor.sortOrder + overTask.sortOrder) / 2
        : overTask.sortOrder / 2;
    } else {
      newSortOrder = neighbor
        ? (overTask.sortOrder + neighbor.sortOrder) / 2
        : overTask.sortOrder + 10000;
    }

    if (newSortOrder === task.sortOrder) return;
    dispatch(optimisticUpdateTask({ id: taskId, sortOrder: newSortOrder }));
    dispatch(moveTask({ id: taskId, status: task.status, sortOrder: newSortOrder }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const altHeld = altHeldRef.current;
    const pointerY = pointerYRef.current;
    setActiveTask(null);
    setReparentHintActive(false);
    altHeldRef.current = false;

    if (!over) return;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const overId = over.id as string;
    const swimlaneDrop = parseSwimlaneDropId(overId);
    const overIsColumn = !swimlaneDrop && statusOptions.some((s) => s.id === overId);
    const overTask = overIsColumn || swimlaneDrop ? null : tasks.find((t) => t.id === overId);

    // Alt+drop: explicit reparent to overTask (works in either mode)
    if (altHeld && overTask) {
      const check = checkReparent(taskId, overTask.id, tasks, task.parentId);
      if (!check.ok) return;
      const warning = getHierarchyRuleViolation(
        task.taskType || "task",
        overTask.taskType || "task",
      );
      dispatch(optimisticUpdateTask({ id: taskId, parentId: overTask.id }));
      dispatch(updateTask({ id: taskId, parentId: overTask.id }));
      if (warning) toast.warning(warning);
      return;
    }

    if (isSwimlaneMode) {
      let destLaneId: string | null = null;
      let destStatus: string | null = null;
      if (swimlaneDrop) {
        destLaneId = swimlaneDrop.laneId;
        destStatus = swimlaneDrop.statusId;
      } else if (overTask) {
        destLaneId = laneIdForTask(overTask);
        destStatus = overTask.status;
      }
      if (destLaneId === null || destStatus === null) return;

      const sourceLaneId = laneIdForTask(task);
      const parentChange = destLaneId !== sourceLaneId;
      const statusChange = destStatus !== task.status;
      const newParentId = destLaneId === NO_EPIC_LANE_ID ? null : destLaneId;

      // In-lane, in-column drag onto another task -> reorder
      if (!parentChange && !statusChange && overTask && over.rect) {
        const laneTasks = destLaneId === NO_EPIC_LANE_ID ? noEpicTasks : tasks.filter((t) => t.parentId === destLaneId);
        const columnTasks = laneTasks.filter((t) => t.status === destStatus);
        reorderWithinColumn(taskId, task, columnTasks, overTask, over.rect, pointerY);
        return;
      }

      if (parentChange && newParentId !== null) {
        const check = checkReparent(taskId, newParentId, tasks, task.parentId);
        if (!check.ok) return;
      }

      if (parentChange || statusChange) {
        let warning: string | null = null;
        if (parentChange) {
          const newParentType =
            newParentId === null
              ? null
              : (tasks.find((t) => t.id === newParentId)?.taskType ?? "task");
          warning = getHierarchyRuleViolation(task.taskType || "task", newParentType);
        }
        dispatch(
          optimisticUpdateTask({
            id: taskId,
            ...(parentChange ? { parentId: newParentId } : {}),
            ...(statusChange ? { status: destStatus } : {}),
          }),
        );
        if (statusChange) {
          dispatch(moveTask({ id: taskId, status: destStatus, sortOrder: 0 }));
        }
        if (parentChange) {
          dispatch(updateTask({ id: taskId, parentId: newParentId }));
        }
        if (warning) toast.warning(warning);
      }
      return;
    }

    // Status-grouped (default) board behaviour
    if (overTask && overTask.status === task.status && over.rect) {
      const columnTasks = tasksByStatus[task.status] ?? [];
      reorderWithinColumn(taskId, task, columnTasks, overTask, over.rect, pointerY);
      return;
    }

    let newStatus: string;
    if (overIsColumn) {
      newStatus = overId;
    } else if (overTask) {
      newStatus = overTask.status;
    } else {
      return;
    }

    if (task.status !== newStatus) {
      dispatch(optimisticUpdateTask({ id: taskId, status: newStatus }));
      dispatch(
        moveTask({
          id: taskId,
          status: newStatus,
          sortOrder: 0,
        })
      );
    }
  };

  // Show empty state if no tasks, no search, and no sprints at all (non-sprint project)
  if (tasks.length === 0 && !searchQuery && !hasSprints) {
    return <EmptyState onCreateTask={handleAddTask} />;
  }

  // Show empty state when no tasks match the current filter
  if (tasks.length === 0 && !searchQuery) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
        <span className="text-sm text-muted-foreground">
          {hasSprints
            ? "No tasks to show. Try clearing filters or adding tasks from the Backlog."
            : "No tasks yet."}
        </span>
      </div>
    );
  }

  // Get the priority option for the dragged task
  const activePriorityOption = activeTask
    ? priorityOptions.find((o) => o.id === activeTask.priority)
    : undefined;
  const activeStatusOption = activeTask
    ? statusOptions.find((o) => o.id === activeTask.status)
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Active sprint banner */}
      {activeSprint && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-primary/5 border-b border-border text-sm">
          <span className="font-medium text-primary">{activeSprint.name}</span>
          {activeSprint.startDate && activeSprint.endDate && (
            <>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground">
                {activeSprint.startDate} – {activeSprint.endDate}
              </span>
            </>
          )}
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">
            {tasks.filter((t) => t.status === "status_done").length}/{tasks.length} done
          </span>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Horizontal scroll container */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {isSwimlaneMode ? (
            <div className="p-4 min-w-max">
              <SwimlaneStatusHeaderRow statusOptions={statusOptions} />
              {epicLanes.map(({ laneId, epic, tasksByStatus: byStatus }) => (
                <BoardSwimlane
                  key={laneId}
                  laneId={laneId}
                  epic={epic}
                  tasksByStatus={byStatus}
                  statusOptions={statusOptions}
                  priorityOptions={priorityOptions}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                  onCheckboxChange={handleCheckboxChange}
                  onAddTask={handleAddTask}
                  projectSlug={project?.slug || ""}
                  reparentHintActive={reparentHintActive}
                  activeDragTaskId={activeTask?.id ?? null}
                  collapsed={isCollapsed(laneId)}
                  onToggleCollapse={() => toggleLane(laneId)}
                  doneStatusIds={doneStatusIds}
                />
              ))}
              <BoardSwimlane
                laneId={NO_EPIC_LANE_ID}
                epic={null}
                tasksByStatus={noEpicByStatus}
                statusOptions={statusOptions}
                priorityOptions={priorityOptions}
                selectedTaskIds={selectedTaskIds}
                onTaskClick={handleTaskClick}
                onCheckboxChange={handleCheckboxChange}
                onAddTask={handleAddTask}
                projectSlug={project?.slug || ""}
                reparentHintActive={reparentHintActive}
                activeDragTaskId={activeTask?.id ?? null}
                collapsed={isCollapsed(NO_EPIC_LANE_ID)}
                onToggleCollapse={() => toggleLane(NO_EPIC_LANE_ID)}
                doneStatusIds={doneStatusIds}
              />
            </div>
          ) : (
            <div className="flex gap-4 p-4 h-full min-w-max">
              {statusOptions.map((status) => (
                <BoardColumn
                  key={status.id}
                  statusOption={status}
                  tasks={tasksByStatus[status.id] || []}
                  priorityOptions={priorityOptions}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                  onCheckboxChange={handleCheckboxChange}
                  onAddTask={handleAddTask}
                  projectSlug={project?.slug || ""}
                  reparentHintActive={reparentHintActive}
                  activeDragTaskId={activeTask?.id ?? null}
                />
              ))}

              {/* Add Status Column - Shortcut to manage statuses */}
              {canEdit && (
                <div className="shrink-0 w-85 relative">
                  <Button
                    variant="ghost"
                    className="w-full h-12 border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground"
                    onClick={() => setIsAddStatusOpen(!isAddStatusOpen)}
                  >
                    <Plus size={16} className="mr-2" />
                    Add Status
                  </Button>
                  {isAddStatusOpen && (
                    <div className="absolute top-14 left-0 z-50">
                      <AddStatusDialog
                        onSubmit={handleAddStatus}
                        onClose={() => setIsAddStatusOpen(false)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drag Overlay - shows the card being dragged */}
        <DragOverlay>
          {activeTask && (
            <div className="w-[320px]">
              <TaskCard
                task={activeTask}
                statusOption={activeStatusOption}
                priorityOption={activePriorityOption}
                onClick={(e) => e.stopPropagation()}
                onCheckboxChange={() => {}}
                isSelected={false}
                projectSlug={project?.slug || ""}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
