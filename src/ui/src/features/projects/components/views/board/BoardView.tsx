/**
 * BoardView - Kanban board view for tasks
 *
 * Features:
 * - Horizontal scroll container for columns
 * - Uses status field options as columns
 * - Drag-and-drop between columns
 * - Task filtering by search query
 */

import { useState, useMemo } from "react";
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
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  selectCurrentProject,
  optimisticUpdateTask,
  updateFieldDefinition,
} from "@/features/projects/store/projectsSlice";
import { selectActiveSprint, selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { moveTask, updateFieldThunk } from "@/features/projects/store/projectsThunks";
import {
  selectSelectedTaskIds,
  selectSearchQuery,
  selectTask,
  toggleTaskSelection,
  openDetailPanel,
  openCreateTaskModal,
} from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, SelectOption } from "@/features/projects/types";
import { BoardColumn } from "./BoardColumn";
import { TaskCard } from "./TaskCard";
import { AddStatusDialog } from "./AddStatusDialog";
import { EmptyState } from "../table/EmptyState";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";

export function BoardView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const filteredTasks = useFilteredTasks(project?.id ?? "");
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const searchQuery = useAppSelector(selectSearchQuery);
  const activeSprint = useAppSelector(selectActiveSprint(project?.id ?? ""));
  const allSprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));
  const hasSprints = allSprints.length > 0;

  const tasks = useMemo(
    () =>
      activeSprint
        ? filteredTasks.filter((t) => t.sprintId === activeSprint.id)
        : filteredTasks,
    [filteredTasks, activeSprint]
  );

  const { canEdit } = useProjectPermission();
  // Track the currently dragged task
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddStatusOpen, setIsAddStatusOpen] = useState(false);

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Determine the target status
    // "over" could be a column ID or another task ID
    let newStatus: string;

    // Check if dropped over a column
    if (statusOptions.some((s) => s.id === over.id)) {
      newStatus = over.id as string;
    } else {
      // Dropped over another task - find that task's status
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) {
        newStatus = overTask.status;
      } else {
        return;
      }
    }

    // Only update if status changed
    if (task.status !== newStatus) {
      // Optimistic update for instant visual feedback
      dispatch(optimisticUpdateTask({ id: taskId, status: newStatus }));
      // Persist via API
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

  // Show empty sprint state when there is an active sprint but no tasks in it
  if (tasks.length === 0 && activeSprint) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-primary/5 border-b border-border text-sm">
          <span className="font-medium text-primary">{activeSprint.name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No tasks in this sprint. Go to Backlog to add tasks.
        </div>
      </div>
    );
  }

  // Project uses sprints but no sprint is currently active
  if (!activeSprint && hasSprints && !searchQuery) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
        <span className="text-sm text-muted-foreground">
          No active sprint. Go to the Backlog to plan and start your next sprint.
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
        {/* Horizontal scroll container for columns */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
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
