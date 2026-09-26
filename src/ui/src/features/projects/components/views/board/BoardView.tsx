import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  selectActiveSprint,
  selectSprintsForProject,
} from "@/features/projects/store/sprintsSlice";
import { moveTask, updateFieldThunk, updateTask } from "@/features/projects/store/projectsThunks";
import { checkReparent } from "@/features/projects/utils/reparent";
import { getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import { optionPaint } from "@/features/projects/utils/statusPaint";
import { statusSemanticOf } from "@/features/projects/utils/statusSemantics";
import {
  selectSearchQuery,
  selectTask,
  openDetailPanel,
  openCreateTaskModal,
} from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { useTaskGroups } from "@/features/projects/hooks/useTaskGroups";
import { selectActiveDefinition } from "@/features/projects/store/viewSelectors";
import { toggleDraftCollapsedGroup } from "@/features/projects/store/viewDraftThunks";
import { fieldRef, isPseudoRef } from "@/features/projects/utils/viewFields";
import {
  groupSums,
  groupWrite,
  type GroupValue,
  type GroupWrite,
  type TaskGroup,
} from "@/features/projects/utils/groupTasks";
import { getTaskFieldValue } from "@/features/projects/utils/taskFieldValue";
import { TaskPseudoField } from "@uniffy/proto/projects/v1/projects_pb";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type {
  Task,
  SelectOption,
  FieldDefinition,
  UpdateTaskRequest,
} from "@/features/projects/types";
import { BoardColumn } from "./BoardColumn";
import { TaskCard } from "./TaskCard";
import { BoardSwimlane, SwimlaneColumnHeaderRow, type BoardColumnSpec } from "./BoardSwimlane";
import { SINGLE_LANE_KEY, buildLaneDropId, parseLaneCardId, parseLaneDropId } from "./boardDropIds";
import { AddStatusDialog } from "./AddStatusDialog";
import { EmptyState } from "../table/EmptyState";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { randomUUID } from "@/shared/utils/uuid";

/** Column for tasks the column field leaves empty; status never is, so only other fields use it. */
const NONE_COLUMN_KEY = "__none__";

const NO_FIELDS: FieldDefinition[] = [];

export function BoardView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const projectId = project?.id ?? "";
  const tasks = useFilteredTasks(projectId, { includeSubtasks: true });
  const searchQuery = useAppSelector(selectSearchQuery);
  const definition = useAppSelector(selectActiveDefinition(projectId));
  const activeSprint = useAppSelector(selectActiveSprint(projectId));
  const allSprints = useAppSelector(selectSprintsForProject(projectId));
  const hasSprints = allSprints.length > 0;
  const fields = project?.fieldDefinitions ?? NO_FIELDS;
  const fieldsById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);

  const groupBy = definition.groupBy;
  // Epic lanes stand for the epics themselves, so epic cards stay out of the lanes.
  const epicLanes = groupBy !== null && isPseudoRef(groupBy.field, TaskPseudoField.EPIC);
  const laneTasks = useMemo(
    () => (epicLanes ? tasks.filter((task) => task.taskType !== "epic") : tasks),
    [epicLanes, tasks],
  );
  const { groups, ctx } = useTaskGroups(projectId, laneTasks, groupBy);
  const isSwimlaneMode = groups !== null;
  const lanes: TaskGroup[] = useMemo(
    () =>
      groups ?? [
        {
          key: SINGLE_LANE_KEY,
          label: "",
          value: { kind: "none" },
          display: "plain",
          tasks,
        },
      ],
    [groups, tasks],
  );

  const { canEdit } = useProjectPermission();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddStatusOpen, setIsAddStatusOpen] = useState(false);
  const altHeldRef = useRef(false);
  const pointerYRef = useRef<number | null>(null);
  const [reparentHintActive, setReparentHintActive] = useState(false);
  const collapsedLanes = useMemo(
    () => new Set(definition.collapsedGroupKeys),
    [definition.collapsedGroupKeys],
  );
  const toggleLane = (laneKey: string) => dispatch(toggleDraftCollapsedGroup(projectId, laneKey));

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

  const statusField = fieldsById.get(SYSTEM_FIELD_IDS.STATUS);
  const statusOptions = statusField?.config.options || [];
  const priorityOptions = fieldsById.get(SYSTEM_FIELD_IDS.PRIORITY)?.config.options || [];
  const numberFields = fields.filter((field) => field.type === "number");

  // Columns come from the layout's single-select field; a field deleted since falls back to status.
  const layoutColumnId = definition.layout.type === "board" ? definition.layout.columnFieldId : "";
  const layoutColumnField = layoutColumnId ? fieldsById.get(layoutColumnId) : undefined;
  const columnField = layoutColumnField?.type === "single_select" ? layoutColumnField : statusField;
  const isStatusColumns = columnField?.id === SYSTEM_FIELD_IDS.STATUS;
  const columnOptions = [...(columnField?.config.options ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const columnIds = new Set(columnOptions.map((option) => option.id));
  const columnKeyOf = (task: Task): string => {
    if (!columnField) return NONE_COLUMN_KEY;
    const value = getTaskFieldValue(task, columnField.id);
    return typeof value === "string" && columnIds.has(value) ? value : NONE_COLUMN_KEY;
  };
  const columns: BoardColumnSpec[] = columnOptions.map((option) => ({
    key: option.id,
    label: option.label,
    paint: optionPaint(columnOptions, option.id, isStatusColumns),
  }));
  if (
    !isStatusColumns &&
    columnField &&
    tasks.some((task) => columnKeyOf(task) === NONE_COLUMN_KEY)
  ) {
    columns.push({
      key: NONE_COLUMN_KEY,
      label: `No ${columnField.name.toLowerCase()}`,
      paint: optionPaint([], undefined, false),
    });
  }
  const byColumn = (laneTaskList: readonly Task[]): Record<string, Task[]> => {
    const result: Record<string, Task[]> = {};
    for (const task of laneTaskList) {
      const key = columnKeyOf(task);
      (result[key] ??= []).push(task);
    }
    return result;
  };

  const doneStatusIds = new Set(
    statusOptions.filter((s) => statusSemanticOf(s) === "completed").map((s) => s.id),
  );

  const handleTaskClick = (taskId: string) => {
    dispatch(selectTask(taskId));
    dispatch(openDetailPanel());
  };

  const handleAddTask = () => {
    dispatch(openCreateTaskModal());
  };

  const handleAddStatus = (label: string) => {
    if (!statusField) return;

    const existingOptions = statusField.config.options || [];
    const maxSortOrder = existingOptions.reduce((max, item) => Math.max(max, item.sortOrder), -1);

    // Empty colour: the backend assigns the new slot on the brand axis when it saves.
    const newOption: SelectOption = {
      id: `status_${randomUUID().slice(0, 8)}`,
      label,
      color: "",
      sortOrder: maxSortOrder + 1,
    };

    const updatedConfig = { ...statusField.config, options: [...existingOptions, newOption] };

    dispatch(
      updateFieldDefinition({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        changes: { config: updatedConfig },
      }),
    );

    dispatch(
      updateFieldThunk({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        updates: { config: updatedConfig },
      }),
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    const card = parseLaneCardId(String(event.active.id));
    const task = card ? tasks.find((t) => t.id === card.taskId) : undefined;
    if (task) setActiveTask(task);
  };

  const reorderWithinColumn = (
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
        : columnTasks.findIndex((t) => t.id === task.id) > overIdx;
    const direction = insertBefore ? -1 : 1;
    let neighborIdx = overIdx + direction;
    while (
      neighborIdx >= 0 &&
      neighborIdx < columnTasks.length &&
      columnTasks[neighborIdx].id === task.id
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
    dispatch(optimisticUpdateTask({ id: task.id, sortOrder: newSortOrder }));
    dispatch(moveTask({ id: task.id, status: task.status, sortOrder: newSortOrder }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const altHeld = altHeldRef.current;
    const pointerY = pointerYRef.current;
    setActiveTask(null);
    setReparentHintActive(false);
    altHeldRef.current = false;

    if (!over) return;

    const source = parseLaneCardId(String(active.id));
    const task = source ? tasks.find((t) => t.id === source.taskId) : undefined;
    if (!source || !task) return;

    const overId = String(over.id);
    const overDrop = parseLaneDropId(overId);
    const overCard = overDrop ? null : parseLaneCardId(overId);
    const overTask = overCard ? tasks.find((t) => t.id === overCard.taskId) : undefined;

    // Alt+drop onto a card makes that card the parent, whatever the lanes.
    if (altHeld && overTask) {
      const check = checkReparent(task.id, overTask.id, tasks, task.parentId);
      if (!check.ok) return;
      const warning = getHierarchyRuleViolation(
        task.taskType || "task",
        overTask.taskType || "task",
      );
      dispatch(optimisticUpdateTask({ id: task.id, parentId: overTask.id }));
      dispatch(updateTask({ id: task.id, parentId: overTask.id }));
      if (warning) toast.warning(warning);
      return;
    }

    let destLane: string;
    let destColumn: string;
    if (overDrop) {
      destLane = overDrop.laneKey;
      destColumn = overDrop.columnKey;
    } else if (overCard && overTask) {
      destLane = overCard.laneKey;
      destColumn = columnKeyOf(overTask);
    } else {
      return;
    }

    const laneChange = isSwimlaneMode && destLane !== source.laneKey;
    const columnChange = destColumn !== columnKeyOf(task);

    if (!laneChange && !columnChange) {
      if (overTask && overTask.id !== task.id && over.rect) {
        const lane = lanes.find((candidate) => candidate.key === destLane);
        const columnTasks = (lane?.tasks ?? []).filter((t) => columnKeyOf(t) === destColumn);
        reorderWithinColumn(task, columnTasks, overTask, over.rect, pointerY);
      }
      return;
    }

    const update: Omit<UpdateTaskRequest, "id"> = {};
    const optimistic: Partial<Task> = {};
    let status: string | null = null;
    let warning: string | null = null;

    const apply = (write: GroupWrite) => {
      switch (write.kind) {
        case "none":
          return;
        case "blocked":
          toast.info(write.reason);
          return;
        case "status":
          status = write.status;
          return;
        case "reparent": {
          const parentId = write.parentId;
          if (parentId !== null && !checkReparent(task.id, parentId, tasks, task.parentId).ok) {
            return;
          }
          const parentType = parentId === null ? null : (ctx.lookup(parentId)?.taskType ?? "task");
          warning = getHierarchyRuleViolation(task.taskType || "task", parentType);
          update.parentId = parentId;
          optimistic.parentId = parentId;
          return;
        }
        case "update": {
          const { fieldValues, ...rest } = write.update;
          Object.assign(update, rest);
          Object.assign(optimistic, rest);
          if (fieldValues) update.fieldValues = { ...update.fieldValues, ...fieldValues };
          return;
        }
      }
    };

    if (columnChange && columnField) {
      const to: GroupValue =
        destColumn === NONE_COLUMN_KEY ? { kind: "none" } : { kind: "id", id: destColumn };
      apply(groupWrite(fieldRef(columnField.id), task, null, to, fieldsById));
    }
    if (laneChange && groupBy) {
      const from = lanes.find((lane) => lane.key === source.laneKey)?.value ?? null;
      const to = lanes.find((lane) => lane.key === destLane)?.value;
      if (to) apply(groupWrite(groupBy.field, task, from, to, fieldsById));
    }
    // Two writes to custom fields merge into one map over the task's current values.
    if (update.fieldValues) {
      optimistic.fieldValues = { ...task.fieldValues, ...update.fieldValues };
    }

    const hasUpdate = Object.keys(update).length > 0;
    if (status === null && !hasUpdate) return;
    dispatch(
      optimisticUpdateTask({ id: task.id, ...optimistic, ...(status !== null ? { status } : {}) }),
    );
    if (status !== null) dispatch(moveTask({ id: task.id, status, sortOrder: 0 }));
    if (hasUpdate) dispatch(updateTask({ id: task.id, ...update }));
    if (warning) toast.warning(warning);
  };

  // Show empty state if no tasks, no search, and no sprints at all (non-sprint project)
  if (tasks.length === 0 && !searchQuery && !hasSprints) {
    return <EmptyState onCreateTask={canEdit ? handleAddTask : undefined} />;
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

  const activePriorityOption = activeTask
    ? priorityOptions.find((o) => o.id === activeTask.priority)
    : undefined;
  const singleLaneColumns = byColumn(tasks);

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
            {tasks.filter((t) => t.completedAt).length}/{tasks.length} done
          </span>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {isSwimlaneMode ? (
            <div className="p-4 min-w-max">
              <SwimlaneColumnHeaderRow columns={columns} />
              {lanes.map((lane) => (
                <BoardSwimlane
                  key={lane.key}
                  group={lane}
                  epic={
                    lane.display === "epic" && lane.value.kind === "id"
                      ? (ctx.lookup(lane.value.id) ?? null)
                      : null
                  }
                  columns={columns}
                  tasksByColumn={byColumn(lane.tasks)}
                  sums={groupSums(lane.tasks, numberFields)}
                  doneCount={lane.tasks.filter((t) => doneStatusIds.has(t.status)).length}
                  statusOptions={statusOptions}
                  priorityOptions={priorityOptions}
                  onTaskClick={handleTaskClick}
                  onAddTask={canEdit ? handleAddTask : undefined}
                  projectSlug={project.slug || ""}
                  reparentHintActive={reparentHintActive}
                  activeDragTaskId={activeTask?.id ?? null}
                  collapsed={collapsedLanes.has(lane.key)}
                  onToggleCollapse={() => toggleLane(lane.key)}
                />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 p-4 h-full min-w-max">
              {columns.map((column) => {
                const columnTasks = singleLaneColumns[column.key] ?? [];
                return (
                  <BoardColumn
                    key={column.key}
                    label={column.label}
                    paint={column.paint}
                    tasks={columnTasks}
                    sums={groupSums(columnTasks, numberFields)}
                    priorityOptions={priorityOptions}
                    onTaskClick={handleTaskClick}
                    onAddTask={canEdit ? handleAddTask : undefined}
                    projectSlug={project.slug || ""}
                    reparentHintActive={reparentHintActive}
                    activeDragTaskId={activeTask?.id ?? null}
                    dropId={buildLaneDropId(SINGLE_LANE_KEY, column.key)}
                    laneKey={SINGLE_LANE_KEY}
                  />
                );
              })}

              {canEdit && isStatusColumns && (
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

        <DragOverlay>
          {activeTask && (
            <div className="w-[320px]">
              <TaskCard
                task={activeTask}
                priorityOption={activePriorityOption}
                onClick={(e) => e.stopPropagation()}
                projectSlug={project.slug || ""}
                sortableId={`overlay:${activeTask.id}`}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
