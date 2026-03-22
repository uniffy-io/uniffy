/**
 * TableView - Spreadsheet-style table view for tasks
 *
 * Features:
 * - Column headers with field names
 * - Click to sort columns
 * - Inline cell editing (double-click)
 * - Row selection with multi-select
 * - Grouping by field with collapsible sections
 * - Keyboard navigation (arrow keys, Enter to edit, Space to select)
 * - Drag-and-drop row reordering
 */

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ArrowUp, ArrowDown, ArrowCounterClockwise, ArrowClockwise, CaretLeft, CaretRight, CaretDown, DotsSixVertical, X, Trash, CheckCircle, ArrowBendDownRight } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  selectCurrentProject,
  optimisticUpdateTask,
  bulkUpdateTasks,
  removeFieldDefinition,
} from "@/features/projects/store/projectsSlice";
import {
  deleteTasks,
  updateTask,
  bulkUpdateTasksThunk,
  createFieldThunk,
  deleteFieldThunk,
} from "@/features/projects/store/projectsThunks";
import {
  selectSelectedTaskIds,
  selectSearchQuery,
  selectTask,
  toggleTaskSelection,
  selectAllTasks,
  clearSelection,
  openDetailPanel,
  openCreateTaskModal,
  setSortConfig,
  selectActiveSortConfig,
  selectActiveGroupByFieldId,
  setEditingCell,
  selectEditingCell,
  setFocusedCell,
  selectFocusedCell,
  pushUndo,
  popUndo,
  popRedo,
  selectUndoStack,
  selectRedoStack,
} from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { moveTask } from "@/features/projects/store/projectsThunks";
import { LAYOUT, TABLE_COLUMNS } from "@/features/projects/constants";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, FieldDefinition, SelectOption } from "@/features/projects/types";
import { SubjectPicker, SubjectAvatarStack } from "@/components/subject";
import { EmptyState } from "./EmptyState";
import { CreateFieldDialog } from "./CreateFieldDialog";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { getTaskTypeConfig, TASK_TYPES } from "@/features/projects/utils/taskTypes";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";

const MAX_SUBTASK_DEPTH = 5;

// ===== Grouping Types =====

interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  tasks: Task[];
}

export function TableView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const searchQuery = useAppSelector(selectSearchQuery);
  const activeSortConfig = useAppSelector(selectActiveSortConfig);
  const groupByFieldId = useAppSelector(selectActiveGroupByFieldId);
  const { canEdit } = useProjectPermission();
  const editingCell = useAppSelector(selectEditingCell);
  const focusedCell = useAppSelector(selectFocusedCell);
  const undoStack = useAppSelector(selectUndoStack);
  const redoStack = useAppSelector(selectRedoStack);
  const allTasks = useAppSelector((state) => state.projects.tasks);
  const filteredTasks = useFilteredTasks(project?.id ?? "");
  const sprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));

  // Track collapsed group sections
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Track expanded parent tasks (for subtask rows)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Track create field dialog
  const [isCreateFieldOpen, setIsCreateFieldOpen] = useState(false);
  // Track known task IDs so we can detect newly created subtasks
  const knownTaskIdsRef = useRef<Set<string>>(new Set());

  // Auto-expand parent when a new subtask is created
  useEffect(() => {
    const currentIds = new Set(Object.keys(allTasks));
    const known = knownTaskIdsRef.current;

    // Find newly added tasks
    for (const id of currentIds) {
      if (!known.has(id)) {
        const task = allTasks[id];
        if (task?.parentId) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-expanding parent when new subtask is created
          setExpandedParents((prev) => {
            if (prev.has(task.parentId!)) return prev;
            const next = new Set(prev);
            next.add(task.parentId!);
            return next;
          });
        }
      }
    }

    knownTaskIdsRef.current = currentIds;
  }, [allTasks]);

  // Get visible fields (system + custom, excluding title)
  const visibleFields = useMemo(() => {
    if (!project) return [];
    return project.fieldDefinitions.filter(
      (f) => f.id !== SYSTEM_FIELD_IDS.TITLE
    );
  }, [project]);

  // Compute groups
  const groups = useMemo((): TaskGroup[] | null => {
    if (!groupByFieldId || !project) return null;

    // Virtual group: Sprint
    if (groupByFieldId === "__sprint__") {
      const sprintMap = new Map(sprints.map((s) => [s.id, s]));
      const grouped: TaskGroup[] = sprints.map((s) => ({
        key: s.id,
        label: s.name,
        tasks: filteredTasks.filter((t) => t.sprintId === s.id),
      }));
      const backlog = filteredTasks.filter(
        (t) => !t.sprintId || !sprintMap.has(t.sprintId)
      );
      if (backlog.length > 0) {
        grouped.push({ key: "__backlog__", label: "Backlog", tasks: backlog });
      }
      return grouped;
    }

    // Virtual group: Task Type
    if (groupByFieldId === "__task_type__") {
      const grouped: TaskGroup[] = TASK_TYPES.map((tt) => ({
        key: tt.value,
        label: tt.label,
        tasks: filteredTasks.filter((t) => (t.taskType || "task") === tt.value),
      }));
      return grouped.filter((g) => g.tasks.length > 0);
    }

    const field = project.fieldDefinitions.find((f) => f.id === groupByFieldId);
    if (!field) return null;

    // For select fields, use option order
    if (field.type === "single_select") {
      const options = field.config.options ?? [];
      const grouped: TaskGroup[] = options.map((opt) => ({
        key: opt.id,
        label: opt.label,
        color: opt.color,
        tasks: filteredTasks.filter((t) => {
          const val = getFieldValue(t, groupByFieldId);
          return val === opt.id;
        }),
      }));

      // Add "No value" group for tasks without a value
      const ungrouped = filteredTasks.filter((t) => {
        const val = getFieldValue(t, groupByFieldId);
        return !val || !options.some((o) => o.id === val);
      });
      if (ungrouped.length > 0) {
        grouped.push({
          key: "__none__",
          label: "No value",
          tasks: ungrouped,
        });
      }

      return grouped;
    }

    // For other field types, group by string value
    const groupMap = new Map<string, Task[]>();
    const ungrouped: Task[] = [];

    for (const task of filteredTasks) {
      const val = getFieldValue(task, groupByFieldId);
      if (val === null || val === undefined || val === "") {
        ungrouped.push(task);
      } else {
        const key = Array.isArray(val) ? val.join(", ") : String(val);
        const existing = groupMap.get(key);
        if (existing) {
          existing.push(task);
        } else {
          groupMap.set(key, [task]);
        }
      }
    }

    const result: TaskGroup[] = [];
    for (const [key, tasks] of groupMap) {
      result.push({ key, label: key, tasks });
    }
    if (ungrouped.length > 0) {
      result.push({ key: "__none__", label: "No value", tasks: ungrouped });
    }

    return result;
  }, [groupByFieldId, project, filteredTasks, sprints]);

  // All tasks for select-all (respects grouping collapsed state)
  const allVisibleTaskIds = useMemo(() => {
    if (!groups) return filteredTasks.map((t) => t.id);
    return groups.flatMap((g) => g.tasks.map((t) => t.id));
  }, [groups, filteredTasks]);

  // Ordered task IDs for keyboard navigation (excludes collapsed groups)
  const orderedTaskIds = useMemo(() => {
    if (!groups) return filteredTasks.map((t) => t.id);
    return groups.flatMap((g) =>
      collapsedGroups.has(g.key) ? [] : g.tasks.map((t) => t.id)
    );
  }, [groups, filteredTasks, collapsedGroups]);

  // Ordered field IDs for keyboard navigation (title + visible fields)
  const orderedFieldIds = useMemo(() => {
    return [SYSTEM_FIELD_IDS.TITLE, ...visibleFields.map((f) => f.id)];
  }, [visibleFields]);

  // Compute total table width for horizontal scroll
  const totalTableWidth = useMemo(() => {
    const dragCol = 28;
    const checkboxCol = TABLE_COLUMNS.CHECKBOX_WIDTH;
    const titleCol = 300;
    const fieldCols = visibleFields.reduce((sum, f) => sum + getColumnWidth(f), 0);
    const addCol = 48;
    return dragCol + checkboxCol + titleCol + fieldCols + addCol;
  }, [visibleFields]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Escape always clears editing and focus
      if (e.key === "Escape") {
        if (editingCell) {
          dispatch(setEditingCell(null));
          return;
        }
        if (focusedCell) {
          dispatch(setFocusedCell(null));
          return;
        }
        return;
      }

      // Undo/Redo (works even in inputs)
      const key = e.key.toLowerCase();
      if (key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        if (undoStack.length > 0) {
          const entry = undoStack[undoStack.length - 1];
          const undoPayload = { id: entry.taskId, ...entry.previousValues } as Partial<Task> & { id: string };
          dispatch(optimisticUpdateTask(undoPayload));
          dispatch(updateTask(undoPayload));
          dispatch(popUndo());
        }
        return;
      }
      if ((key === "z" || key === "y") && (e.ctrlKey || e.metaKey) && (e.shiftKey || key === "y")) {
        e.preventDefault();
        if (redoStack.length > 0) {
          const entry = redoStack[redoStack.length - 1];
          const redoPayload = { id: entry.taskId, ...entry.newValues } as Partial<Task> & { id: string };
          dispatch(optimisticUpdateTask(redoPayload));
          dispatch(updateTask(redoPayload));
          dispatch(popRedo());
        }
        return;
      }

      // Don't handle navigation while typing in inputs
      if (isInput) return;

      // Only handle navigation when table view is active
      if (!focusedCell && !["ArrowDown", "ArrowUp"].includes(e.key)) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (!focusedCell) {
            if (orderedTaskIds.length > 0 && orderedFieldIds.length > 0) {
              dispatch(setFocusedCell({ taskId: orderedTaskIds[0], fieldId: orderedFieldIds[0] }));
            }
            return;
          }
          const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
          if (rowIdx < orderedTaskIds.length - 1) {
            dispatch(setFocusedCell({ taskId: orderedTaskIds[rowIdx + 1], fieldId: focusedCell.fieldId }));
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (!focusedCell) {
            if (orderedTaskIds.length > 0 && orderedFieldIds.length > 0) {
              dispatch(setFocusedCell({ taskId: orderedTaskIds[orderedTaskIds.length - 1], fieldId: orderedFieldIds[0] }));
            }
            return;
          }
          const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
          if (rowIdx > 0) {
            dispatch(setFocusedCell({ taskId: orderedTaskIds[rowIdx - 1], fieldId: focusedCell.fieldId }));
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (!focusedCell) return;
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (colIdx < orderedFieldIds.length - 1) {
            dispatch(setFocusedCell({ taskId: focusedCell.taskId, fieldId: orderedFieldIds[colIdx + 1] }));
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (!focusedCell) return;
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (colIdx > 0) {
            dispatch(setFocusedCell({ taskId: focusedCell.taskId, fieldId: orderedFieldIds[colIdx - 1] }));
          }
          break;
        }
        case "Tab": {
          if (!focusedCell) return;
          e.preventDefault();
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (e.shiftKey) {
            if (colIdx > 0) {
              dispatch(setFocusedCell({ taskId: focusedCell.taskId, fieldId: orderedFieldIds[colIdx - 1] }));
            } else {
              const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
              if (rowIdx > 0) {
                dispatch(setFocusedCell({ taskId: orderedTaskIds[rowIdx - 1], fieldId: orderedFieldIds[orderedFieldIds.length - 1] }));
              }
            }
          } else {
            if (colIdx < orderedFieldIds.length - 1) {
              dispatch(setFocusedCell({ taskId: focusedCell.taskId, fieldId: orderedFieldIds[colIdx + 1] }));
            } else {
              const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
              if (rowIdx < orderedTaskIds.length - 1) {
                dispatch(setFocusedCell({ taskId: orderedTaskIds[rowIdx + 1], fieldId: orderedFieldIds[0] }));
              }
            }
          }
          break;
        }
        case "Enter": {
          if (!focusedCell) return;
          e.preventDefault();
          if (focusedCell.fieldId === SYSTEM_FIELD_IDS.TITLE) {
            dispatch(selectTask(focusedCell.taskId));
            dispatch(openDetailPanel());
          } else {
            dispatch(setEditingCell({ taskId: focusedCell.taskId, fieldId: focusedCell.fieldId }));
          }
          break;
        }
        case " ": {
          if (!focusedCell) return;
          e.preventDefault();
          dispatch(toggleTaskSelection(focusedCell.taskId));
          break;
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingCell, focusedCell, dispatch, orderedTaskIds, orderedFieldIds, undoStack, redoStack]);

  const handleRowClick = useCallback((taskId: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      dispatch(toggleTaskSelection(taskId));
    } else {
      dispatch(selectTask(taskId));
      dispatch(openDetailPanel());
    }
  }, [dispatch]);

  const handleCheckboxClick = useCallback((taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(toggleTaskSelection(taskId));
  }, [dispatch]);

  const handleSelectAll = useCallback(() => {
    if (selectedTaskIds.length === allVisibleTaskIds.length) {
      dispatch(clearSelection());
    } else {
      dispatch(selectAllTasks(allVisibleTaskIds));
    }
  }, [dispatch, selectedTaskIds.length, allVisibleTaskIds]);

  const handleAddTask = useCallback(() => {
    dispatch(openCreateTaskModal());
  }, [dispatch]);

  const handleHeaderClick = useCallback((fieldId: string) => {
    if (activeSortConfig?.fieldId === fieldId) {
      if (activeSortConfig.direction === "asc") {
        dispatch(setSortConfig({ fieldId, direction: "desc" }));
      } else {
        dispatch(setSortConfig(null));
      }
    } else {
      dispatch(setSortConfig({ fieldId, direction: "asc" }));
    }
  }, [dispatch, activeSortConfig]);

  const handleStartEdit = useCallback((taskId: string, fieldId: string) => {
    if (!canEdit) return;
    dispatch(setEditingCell({ taskId, fieldId }));
  }, [dispatch, canEdit]);

  const handleEndEdit = useCallback(() => {
    dispatch(setEditingCell(null));
  }, [dispatch]);

  const handleSaveField = useCallback((taskId: string, fieldId: string, value: unknown) => {
    if (!canEdit) return;
    const task = allTasks[taskId];
    const update: Partial<Task> & { id: string } = { id: taskId };
    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    switch (fieldId) {
      case SYSTEM_FIELD_IDS.STATUS:
        previousValues.status = task?.status;
        newValues.status = value;
        update.status = value as string;
        break;
      case SYSTEM_FIELD_IDS.PRIORITY:
        previousValues.priority = task?.priority;
        newValues.priority = value;
        update.priority = value as string;
        break;
      case SYSTEM_FIELD_IDS.START_DATE:
        previousValues.startDate = task?.startDate;
        newValues.startDate = value;
        update.startDate = (value as string) || null;
        break;
      case SYSTEM_FIELD_IDS.DUE_DATE:
        previousValues.dueDate = task?.dueDate;
        newValues.dueDate = value;
        update.dueDate = (value as string) || null;
        break;
      case SYSTEM_FIELD_IDS.ASSIGNEE:
        previousValues.assigneeIds = task?.assigneeIds;
        newValues.assigneeIds = value;
        update.assigneeIds = value as string[];
        break;
      default:
        previousValues.fieldValues = { [fieldId]: task?.fieldValues?.[fieldId] };
        newValues.fieldValues = { [fieldId]: value };
        update.fieldValues = { [fieldId]: value as string };
        break;
    }

    // Push undo entry before applying
    dispatch(pushUndo({
      id: `undo-${Date.now()}`,
      actionType: "updateField",
      taskId,
      previousValues,
      newValues,
      timestamp: Date.now(),
      description: `Changed ${fieldId} of ${task?.title ?? taskId}`,
    }));

    dispatch(optimisticUpdateTask(update));
    dispatch(updateTask(update));
    // Don't close editing cell for multi-select fields (assignee picker stays open)
    if (fieldId !== SYSTEM_FIELD_IDS.ASSIGNEE) {
      dispatch(setEditingCell(null));
    }
  }, [dispatch, allTasks, canEdit]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const handleCellClick = useCallback((taskId: string, fieldId: string) => {
    dispatch(setFocusedCell({ taskId, fieldId }));
  }, [dispatch]);

  const handleTitleClick = useCallback((taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(selectTask(taskId));
    dispatch(openDetailPanel());
  }, [dispatch]);

  // ===== Drag-and-Drop =====
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = filteredTasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  }, [filteredTasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (!over || active.id === over.id) return;

    const activeIdx = orderedTaskIds.indexOf(active.id as string);
    const overIdx = orderedTaskIds.indexOf(over.id as string);

    if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return;

    const activeTask = filteredTasks[activeIdx];
    const overTask = filteredTasks[overIdx];

    let newSortOrder: number;

    // Moving UP (activeIdx > overIdx):
    // Insert BEFORE overTask.
    // New sortOrder should be between prevTask (if exists) and overTask.
    if (activeIdx > overIdx) {
      const prevTask = overIdx > 0 ? filteredTasks[overIdx - 1] : null;
      if (prevTask) {
        newSortOrder = (prevTask.sortOrder + overTask.sortOrder) / 2;
      } else {
        // Moved to the very top
        newSortOrder = overTask.sortOrder / 2;
      }
    } 
    // Moving DOWN (activeIdx < overIdx):
    // Insert AFTER overTask.
    // New sortOrder should be between overTask and nextTask (if exists).
    else {
      const nextTask = overIdx < filteredTasks.length - 1 ? filteredTasks[overIdx + 1] : null;
      if (nextTask) {
        newSortOrder = (overTask.sortOrder + nextTask.sortOrder) / 2;
      } else {
        // Moved to the very bottom
        newSortOrder = overTask.sortOrder + 10000;
      }
    }

    dispatch(optimisticUpdateTask({ id: active.id as string, sortOrder: newSortOrder }));
    dispatch(moveTask({ id: active.id as string, status: activeTask.status, sortOrder: newSortOrder }));
  }, [dispatch, orderedTaskIds, filteredTasks]);

  const toggleParentExpand = useCallback((taskId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const getSubtasksForParent = useCallback(
    (parentId: string): Task[] => {
      return Object.values(allTasks)
        .filter((t) => t.parentId === parentId && !t.deletedAt)
        .sort((a, b) => a.number - b.number);
    },
    [allTasks]
  );

  if (!project) {
    return null;
  }

  if (filteredTasks.length === 0 && !searchQuery) {
    return <EmptyState onCreateTask={handleAddTask} />;
  }

  const renderSubtaskRow = (task: Task, depth: number = 1): React.ReactNode => {
    const hasChildren = task.subtaskTotal > 0 && depth < MAX_SUBTASK_DEPTH;
    const isExp = expandedParents.has(task.id);
    const childSubtasks = isExp ? getSubtasksForParent(task.id) : [];

    return (
      <div key={task.id}>
        <TableRow
          task={task}
          fields={visibleFields}
          isSelected={selectedTaskIds.includes(task.id)}
          editingFieldId={editingCell?.taskId === task.id ? editingCell.fieldId : null}
          focusedFieldId={focusedCell?.taskId === task.id ? focusedCell.fieldId : null}
          onClick={(e) => handleRowClick(task.id, e)}
          onCheckboxClick={(e) => handleCheckboxClick(task.id, e)}
          onStartEdit={(fieldId) => handleStartEdit(task.id, fieldId)}
          onEndEdit={handleEndEdit}
          onSaveField={(fieldId, value) => handleSaveField(task.id, fieldId, value)}
          onCellClick={(fieldId) => handleCellClick(task.id, fieldId)}
          onTitleClick={(e) => handleTitleClick(task.id, e)}
          isSubtask
          subtaskDepth={depth}
          expandable={hasChildren}
          isExpanded={isExp}
          onToggleExpand={() => toggleParentExpand(task.id)}
        />
        {isExp && childSubtasks.map((child) => renderSubtaskRow(child, depth + 1))}
      </div>
    );
  };

  const renderSortableRowWithSubtasks = (task: Task) => {
    const hasSubtasks = task.subtaskTotal > 0;
    const isExpanded = expandedParents.has(task.id);
    const subtasks = isExpanded ? getSubtasksForParent(task.id) : [];

    return (
      <div key={task.id}>
        <SortableTableRow
          task={task}
          fields={visibleFields}
          isSelected={selectedTaskIds.includes(task.id)}
          editingFieldId={editingCell?.taskId === task.id ? editingCell.fieldId : null}
          focusedFieldId={focusedCell?.taskId === task.id ? focusedCell.fieldId : null}
          onClick={(e) => handleRowClick(task.id, e)}
          onCheckboxClick={(e) => handleCheckboxClick(task.id, e)}
          onStartEdit={(fieldId) => handleStartEdit(task.id, fieldId)}
          onEndEdit={handleEndEdit}
          onSaveField={(fieldId, value) => handleSaveField(task.id, fieldId, value)}
          onCellClick={(fieldId) => handleCellClick(task.id, fieldId)}
          onTitleClick={(e) => handleTitleClick(task.id, e)}
          expandable={hasSubtasks}
          isExpanded={isExpanded}
          onToggleExpand={() => toggleParentExpand(task.id)}
        />
        {isExpanded && subtasks.map((child) => renderSubtaskRow(child, 1))}
      </div>
    );
  };

  // Get status and priority options for bulk editing
  const statusField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const statusOptions = statusField?.config.options ?? [];
  const priorityField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
  const priorityOptions = priorityField?.config.options ?? [];

  return (
    <div className="flex flex-col h-full relative">
      {/* Bulk Edit Toolbar */}
      {selectedTaskIds.length > 1 && (
        <BulkEditToolbar
          count={selectedTaskIds.length}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          onChangeStatus={(statusId) => {
            dispatch(bulkUpdateTasks({ ids: selectedTaskIds, changes: { status: statusId } }));
            dispatch(bulkUpdateTasksThunk({ taskIds: selectedTaskIds, updates: { status: statusId } }));
          }}
          onChangePriority={(priorityId) => {
            dispatch(bulkUpdateTasks({ ids: selectedTaskIds, changes: { priority: priorityId } }));
            dispatch(bulkUpdateTasksThunk({ taskIds: selectedTaskIds, updates: { priority: priorityId } }));
          }}
          onDelete={() => {
            dispatch(deleteTasks(selectedTaskIds));
            dispatch(clearSelection());
          }}
          onClearSelection={() => dispatch(clearSelection())}
        />
      )}

      {/* Scrollable Table (header + body scroll together horizontally) */}
      <ScrollArea className="flex-1">
        <div style={{ minWidth: totalTableWidth }}>
          {/* Table Header (sticky for vertical scroll) */}
          <div
            className="sticky top-0 z-10 flex items-center border-b border-border bg-muted"
            style={{ height: LAYOUT.TABLE_HEADER_HEIGHT }}
          >
            {/* Drag Handle Column */}
            <div
              className="shrink-0 border-r border-border bg-muted/30"
              style={{ width: 28 }}
            />

            {/* Checkbox Column */}
            <div
              className="shrink-0 flex items-center justify-center border-r border-border bg-muted/30"
              style={{ width: TABLE_COLUMNS.CHECKBOX_WIDTH }}
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={allVisibleTaskIds.length > 0 && selectedTaskIds.length === allVisibleTaskIds.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = selectedTaskIds.length > 0 && selectedTaskIds.length < allVisibleTaskIds.length;
                  }
                }}
                onChange={handleSelectAll}
              />
            </div>

            {/* Title Column */}
            <div
              className="shrink-0 flex items-center px-3 border-r border-border cursor-pointer hover:bg-muted/30 transition-colors select-none"
              style={{ width: 300 }}
              onClick={() => handleHeaderClick(SYSTEM_FIELD_IDS.TITLE)}
            >
              <span className="text-xs font-medium text-muted-foreground flex-1">Title</span>
              {activeSortConfig?.fieldId === SYSTEM_FIELD_IDS.TITLE && (
                activeSortConfig.direction === "asc"
                  ? <ArrowUp size={12} className="text-primary ml-1 shrink-0" />
                  : <ArrowDown size={12} className="text-primary ml-1 shrink-0" />
              )}
            </div>

            {/* Field Columns */}
            {visibleFields.map((field) => (
              <div
                key={field.id}
                className="shrink-0 flex items-center px-3 border-r border-border cursor-pointer hover:bg-muted/30 transition-colors select-none group"
                style={{ width: getColumnWidth(field) }}
                onClick={() => handleHeaderClick(field.id)}
                onContextMenu={(e) => {
                  if (!field.isSystem && project) {
                    e.preventDefault();
                    dispatch(removeFieldDefinition({ projectId: project.id, fieldId: field.id }));
                    dispatch(deleteFieldThunk({ projectId: project.id, fieldId: field.id }));
                  }
                }}
              >
                <span className="text-xs font-medium text-muted-foreground flex-1">
                  {field.name}
                </span>
                {!field.isSystem && (
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive ml-1 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (project) {
                        dispatch(removeFieldDefinition({ projectId: project.id, fieldId: field.id }));
                        dispatch(deleteFieldThunk({ projectId: project.id, fieldId: field.id }));
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
                {activeSortConfig?.fieldId === field.id && (
                  activeSortConfig.direction === "asc"
                    ? <ArrowUp size={12} className="text-primary ml-1 shrink-0" />
                    : <ArrowDown size={12} className="text-primary ml-1 shrink-0" />
                )}
              </div>
            ))}

            {/* Add Column Button */}
            <div className="shrink-0 flex items-center px-2 relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsCreateFieldOpen(!isCreateFieldOpen)}
              >
                <Plus size={14} className="text-muted-foreground" />
              </Button>
              {isCreateFieldOpen && project && (
                <CreateFieldDialog
                  projectId={project.id}
                  onSubmit={(field) => {
                    dispatch(createFieldThunk({ projectId: project.id, field: { name: field.name, type: field.type, isRequired: field.isRequired, isSystem: field.isSystem, sortOrder: field.sortOrder, config: field.config } }));
                  }}
                  onClose={() => setIsCreateFieldOpen(false)}
                />
              )}
            </div>

          </div>

          {/* Table Body */}
          <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div>
            {groups ? (
              // Grouped rendering with per-group SortableContext
              groups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.key);
                const groupTaskIds = group.tasks.map((t) => t.id);
                return (
                  <div key={group.key}>
                    {/* Group Header */}
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border cursor-pointer hover:bg-muted/60 transition-colors select-none"
                      style={{ height: LAYOUT.TABLE_ROW_HEIGHT }}
                      onClick={() => toggleGroup(group.key)}
                    >
                      <div style={{ width: 28 }} className="shrink-0" />
                      {isCollapsed
                        ? <CaretRight size={14} className="text-muted-foreground shrink-0" />
                        : <CaretDown size={14} className="text-muted-foreground shrink-0" />
                      }
                      {group.color && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                      )}
                      <span className="text-sm font-medium text-foreground">
                        {group.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.tasks.length}
                      </span>
                    </div>

                    {/* Group Tasks - each group has its own sortable context */}
                    {!isCollapsed && (
                      <SortableContext items={groupTaskIds} strategy={verticalListSortingStrategy}>
                        {group.tasks.map(renderSortableRowWithSubtasks)}
                      </SortableContext>
                    )}
                  </div>
                );
              })
            ) : (
              // Flat rendering with single SortableContext
              <SortableContext items={orderedTaskIds} strategy={verticalListSortingStrategy}>
                {filteredTasks.map(renderSortableRowWithSubtasks)}
              </SortableContext>
            )}

            {/* Add Task Row */}
            <div
              className="flex items-center border-b border-border hover:bg-muted/30 cursor-pointer"
              style={{ height: LAYOUT.TABLE_ROW_HEIGHT }}
              onClick={handleAddTask}
            >
              <div className="shrink-0" style={{ width: 28 }} />
              <div
                className="shrink-0 flex items-center justify-center border-r border-border"
                style={{ width: TABLE_COLUMNS.CHECKBOX_WIDTH }}
              />
              <div className="flex items-center gap-2 px-3 text-muted-foreground">
                <Plus size={14} />
                <span className="text-sm">Add task</span>
              </div>
            </div>
          </div>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeTask && (
              <div
                className="flex items-center bg-card border border-border shadow-lg rounded opacity-90"
                style={{ height: LAYOUT.TABLE_ROW_HEIGHT }}
              >
                <div className="shrink-0 flex items-center justify-center" style={{ width: 28 }}>
                  <DotsSixVertical size={14} className="text-muted-foreground" />
                </div>
                <div className="px-3 text-sm text-foreground truncate">
                  {activeTask.title}
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
        </div>
      </ScrollArea>

      {/* Floating Undo/Redo pill */}
      {(undoStack.length > 0 || redoStack.length > 0) && (
        <div className="absolute bottom-4 right-4 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border bg-card shadow-lg z-10">
          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={() => {
              if (undoStack.length > 0) {
                const entry = undoStack[undoStack.length - 1];
                const payload = { id: entry.taskId, ...entry.previousValues } as Partial<Task> & { id: string };
                dispatch(optimisticUpdateTask(payload));
                dispatch(updateTask(payload));
                dispatch(popUndo());
              }
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <ArrowCounterClockwise size={16} />
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            type="button"
            disabled={redoStack.length === 0}
            onClick={() => {
              if (redoStack.length > 0) {
                const entry = redoStack[redoStack.length - 1];
                const payload = { id: entry.taskId, ...entry.newValues } as Partial<Task> & { id: string };
                dispatch(optimisticUpdateTask(payload));
                dispatch(updateTask(payload));
                dispatch(popRedo());
              }
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            <ArrowClockwise size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ===== Bulk Edit Toolbar =====

interface BulkEditToolbarProps {
  count: number;
  statusOptions: SelectOption[];
  priorityOptions: SelectOption[];
  onChangeStatus: (statusId: string) => void;
  onChangePriority: (priorityId: string) => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

function BulkEditToolbar({
  count,
  statusOptions,
  priorityOptions,
  onChangeStatus,
  onChangePriority,
  onDelete,
  onClearSelection,
}: BulkEditToolbarProps) {
  const [openDropdown, setOpenDropdown] = useState<"status" | "priority" | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={dropdownRef}
      className="shrink-0 flex items-center gap-2 px-4 border-b border-primary/30 bg-primary/5"
      style={{ height: LAYOUT.TABLE_HEADER_HEIGHT }}
    >
      <span className="text-sm font-medium text-primary">{count} selected</span>

      {/* Status Dropdown */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setOpenDropdown(openDropdown === "status" ? null : "status")}
        >
          Status
        </Button>
        {openDropdown === "status" && (
          <div className="absolute top-full left-0 z-50 mt-1 min-w-36 rounded-md border border-border bg-card shadow-lg py-1 max-h-48 overflow-y-auto">
            {statusOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChangeStatus(opt.id); setOpenDropdown(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Priority Dropdown */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
        >
          Priority
        </Button>
        {openDropdown === "priority" && (
          <div className="absolute top-full left-0 z-50 mt-1 min-w-36 rounded-md border border-border bg-card shadow-lg py-1 max-h-48 overflow-y-auto">
            {priorityOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChangePriority(opt.id); setOpenDropdown(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash size={14} className="mr-1" />
        Delete
      </Button>

      <div className="flex-1" />

      {/* Clear Selection */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onClearSelection}
      >
        <X size={14} />
      </Button>
    </div>
  );
}

// ===== Table Row =====

interface TableRowProps {
  task: Task;
  fields: FieldDefinition[];
  isSelected: boolean;
  editingFieldId: string | null;
  focusedFieldId: string | null;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onStartEdit: (fieldId: string) => void;
  onEndEdit: () => void;
  onSaveField: (fieldId: string, value: unknown) => void;
  onCellClick: (fieldId: string) => void;
  onTitleClick: (e: React.MouseEvent) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
  style?: React.CSSProperties;
  rowRef?: (node: HTMLElement | null) => void;
  isSubtask?: boolean;
  subtaskDepth?: number;
  expandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function SortableTableRow(props: Omit<TableRowProps, "dragHandleProps" | "isDragging" | "style" | "rowRef">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <TableRow
      {...props}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
      style={style}
      rowRef={setNodeRef}
    />
  );
}

function TableRow({
  task,
  fields,
  isSelected,
  editingFieldId,
  focusedFieldId,
  onClick,
  onCheckboxClick,
  onStartEdit,
  onEndEdit,
  onSaveField,
  onCellClick,
  onTitleClick,
  dragHandleProps,
  isDragging,
  style,
  rowRef,
  isSubtask,
  subtaskDepth,
  expandable,
  isExpanded,
  onToggleExpand,
}: TableRowProps) {
  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center border-b border-border cursor-pointer relative",
        "hover:bg-muted/30 transition-colors",
        isSelected && "bg-primary/5",
        isDragging && "bg-muted/50",
        isSubtask && "bg-muted/10"
      )}
      style={{ height: LAYOUT.TABLE_ROW_HEIGHT, ...style }}
      onClick={onClick}
    >
      {/* Selection Indicator */}
      {isSelected && (
        <div className="absolute left-0 w-0.5 h-full bg-primary" />
      )}

      {/* Drag Handle / Subtask indent */}
      <div
        className={cn(
          "shrink-0 flex items-center justify-center",
          isSubtask
            ? "text-muted-foreground/30"
            : "cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
        )}
        style={{ width: 28 }}
        {...(isSubtask ? {} : dragHandleProps)}
        onClick={(e) => e.stopPropagation()}
      >
        {isSubtask
          ? <ArrowBendDownRight size={12} className="text-muted-foreground/40" />
          : <DotsSixVertical size={14} />
        }
      </div>

      {/* Checkbox Column */}
      <div
        className="shrink-0 flex items-center justify-center border-r border-border"
        style={{ width: TABLE_COLUMNS.CHECKBOX_WIDTH }}
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border"
          checked={isSelected}
          onChange={() => {}}
          onClick={onCheckboxClick}
        />
      </div>

      {/* Title Column - single click opens detail panel */}
      <div
        className={cn(
          "shrink-0 flex items-center border-r border-border overflow-hidden",
          focusedFieldId === SYSTEM_FIELD_IDS.TITLE && "ring-2 ring-inset ring-primary",
          !isSubtask && "px-3"
        )}
        style={{ width: 300, ...(isSubtask ? { paddingLeft: 24 + (subtaskDepth ?? 1) * 16, paddingRight: 12 } : {}) }}
        onClick={onTitleClick}
      >
        {/* Expand/collapse chevron for parent tasks */}
        {expandable && (
          <button
            type="button"
            className="mr-1.5 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
          >
            {isExpanded
              ? <CaretDown size={12} />
              : <CaretRight size={12} />
            }
          </button>
        )}
        {task.subtaskTotal > 0 && (
          <span className="mr-1.5 flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <CheckCircle size={10} className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""} />
            {task.subtaskCompleted}/{task.subtaskTotal}
          </span>
        )}
        <TaskTitleCell task={task} />
      </div>

      {/* Field Columns */}
      {fields.map((field) => {
        const isDropdownOpen = editingFieldId === field.id && (field.type === "single_select" || field.type === "date" || field.type === "person");
        return (
        <div
          key={field.id}
          className={cn(
            "shrink-0 flex items-center px-3 border-r border-border relative",
            isDropdownOpen ? "overflow-visible" : "overflow-hidden",
            focusedFieldId === field.id && "ring-2 ring-inset ring-primary"
          )}
          style={{ width: getColumnWidth(field) }}
          onClick={(e) => { e.stopPropagation(); onCellClick(field.id); }}
        >
          <EditableFieldCell
            task={task}
            field={field}
            isEditing={editingFieldId === field.id}
            onStartEdit={() => onStartEdit(field.id)}
            onEndEdit={onEndEdit}
            onSave={(value) => onSaveField(field.id, value)}
          />
        </div>
        );
      })}
    </div>
  );
}

// ===== Editable Field Cell =====

interface EditableFieldCellProps {
  task: Task;
  field: FieldDefinition;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onSave: (value: unknown) => void;
}

function EditableFieldCell({ task, field, isEditing, onStartEdit, onEndEdit, onSave }: EditableFieldCellProps) {
  const isSelectField = field.type === "single_select";
  const isDateField = field.type === "date";
  const isPersonField = field.type === "person";

  // Select fields: badge + caret trigger, dropdown appears below when editing
  if (isSelectField) {
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => { e.stopPropagation(); if (!isEditing) onStartEdit(); }}
      >
        <FieldCell task={task} field={field} />
        <CaretDown size={12} className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineSelectEditor
            options={field.config.options ?? []}
            currentValue={String(getFieldValue(task, field.id) ?? "")}
            onSave={onSave}
            onClose={onEndEdit}
          />
        )}
      </div>
    );
  }

  // Date fields: date display + caret trigger, date picker appears below when editing
  if (isDateField) {
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => { e.stopPropagation(); if (!isEditing) onStartEdit(); }}
      >
        <FieldCell task={task} field={field} />
        <CaretDown size={12} className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineDateEditor
            currentValue={String(getFieldValue(task, field.id) ?? "")}
            onSave={onSave}
            onClose={onEndEdit}
          />
        )}
      </div>
    );
  }

  // Person fields: avatar stack + "+" trigger, assignee picker appears below when editing
  if (isPersonField) {
    const assigneeIds = (Array.isArray(getFieldValue(task, field.id)) ? getFieldValue(task, field.id) : task.assigneeIds) as string[];
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => { e.stopPropagation(); if (!isEditing) onStartEdit(); }}
      >
        <FieldCell task={task} field={field} />
        <Plus size={12} weight="bold" className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineAssigneeEditor
            currentAssigneeIds={assigneeIds}
            onSave={onSave}
            onClose={onEndEdit}
          />
        )}
      </div>
    );
  }

  if (!isEditing) {
    return (
      <div
        className="w-full h-full flex items-center"
        onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}
      >
        <FieldCell task={task} field={field} />
      </div>
    );
  }

  const value = getFieldValue(task, field.id);

  switch (field.type) {

    case "text":
    case "number":
      return (
        <InlineTextInput
          initialValue={String(value ?? "")}
          type={field.type === "number" ? "number" : "text"}
          onSave={onSave}
          onCancel={onEndEdit}
        />
      );

    default:
      // Person and other complex types: fall back to read-only
      onEndEdit();
      return <FieldCell task={task} field={field} />;
  }
}

// ===== Inline Editors =====

function InlineTextInput({ initialValue, type, onSave, onCancel }: {
  initialValue: string;
  type: "text" | "number";
  onSave: (value: unknown) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      onSave(type === "number" ? Number(value) : value);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(type === "number" ? Number(value) : value)}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className="w-full h-full px-1 text-sm bg-background border border-primary rounded outline-none text-foreground"
    />
  );
}

function InlineSelectEditor({ options, currentValue, onSave, onClose }: {
  options: SelectOption[];
  currentValue: string;
  onSave: (value: unknown) => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 z-50 mt-1 min-w-35 rounded-md border border-border bg-card shadow-lg py-1 max-h-48 overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => {
            onSave(option.id);
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
            option.id === currentValue ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: option.color }}
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InlineDateEditor({ currentValue, onSave, onClose }: {
  currentValue: string;
  onSave: (value: unknown) => void;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const selectedDate = useMemo(() => {
    if (!currentValue) return null;
    const d = new Date(currentValue);
    return isNaN(d.getTime()) ? null : d;
  }, [currentValue]);

  const [displayMonth, setDisplayMonth] = useState<Date>(
    () => selectedDate || new Date()
  );

  // Position the dropdown to the left, aligned to the right edge of the cell
  useEffect(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.right - 280 });

    const handleScroll = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPosition({ top: r.bottom + 4, left: r.right - 280 });
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const calendarDays = useMemo(() => {
    const monthStart = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
    const monthEnd = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0);
    // Start from previous Sunday
    const calStart = new Date(monthStart);
    calStart.setDate(calStart.getDate() - calStart.getDay());
    // End at next Saturday
    const calEnd = new Date(monthEnd);
    calEnd.setDate(calEnd.getDate() + (6 - calEnd.getDay()));

    const days: Date[] = [];
    const cur = new Date(calStart);
    while (cur <= calEnd) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [displayMonth]);

  const handleDayClick = (day: Date) => {
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    onSave(`${yyyy}-${mm}-${dd}`);
    onClose();
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const today = new Date();

  const dropdown = position ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: "fixed", top: position.top, left: position.left, width: 280 }}
      className="z-200 rounded-lg border border-border bg-card shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Month navigation */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <button
          type="button"
          onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <CaretLeft size={16} weight="bold" />
        </button>
        <span className="text-sm font-medium text-foreground">
          {displayMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <CaretRight size={16} weight="bold" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {weekdays.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 px-2 pb-2">
        {calendarDays.map((day) => {
          const isCurrentMonth = day.getMonth() === displayMonth.getMonth();
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const isCurrentDay = isSameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleDayClick(day)}
              className={cn(
                "h-8 w-full rounded-md text-sm transition-colors",
                !isCurrentMonth && "text-muted-foreground/40",
                isCurrentMonth && !isSelected && "text-foreground hover:bg-muted",
                isCurrentDay && !isSelected && "font-semibold text-primary",
                isSelected && "bg-primary text-primary-foreground font-medium"
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <button
          type="button"
          onClick={() => handleDayClick(today)}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Today
        </button>
        {currentValue && (
          <button
            type="button"
            onClick={() => { onSave(null); onClose(); }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div ref={triggerRef} className="absolute top-0 left-0 w-full h-full" />
      {dropdown}
    </>
  );
}

function InlineAssigneeEditor({ currentAssigneeIds, onSave, onClose }: {
  currentAssigneeIds: string[];
  onSave: (value: unknown) => void;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback((ids: string[]) => {
    onSave(ids);
  }, [onSave]);

  return (
    <>
      <div ref={triggerRef} className="absolute top-0 left-0 w-full h-full" />
      <SubjectPicker
        mode="multi"
        subjectTypes="all"
        value={currentAssigneeIds}
        onChange={handleChange}
        portal
        anchorRef={triggerRef}
        onClose={onClose}
        autoFocus
      />
    </>
  );
}

// ===== Task Title Cell =====

function TaskTitleCell({ task }: { task: Task }) {
  const project = useAppSelector(selectCurrentProject);
  const typeConfig = getTaskTypeConfig(task.taskType || "task");
  const TypeIcon = typeConfig.icon;
  const ticketId = `${project?.slug || ""}-${task.number}`;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <TypeIcon size={14} className="text-muted-foreground shrink-0" weight="fill" />
      <span className="text-xs font-mono text-muted-foreground shrink-0">{ticketId}</span>
      <span className="truncate text-foreground text-sm">{task.title}</span>
    </div>
  );
}

// ===== Display Components =====

interface FieldCellProps {
  task: Task;
  field: FieldDefinition;
}

function FieldCell({ task, field }: FieldCellProps) {
  const value = getFieldValue(task, field.id);

  switch (field.type) {
    case "single_select": {
      const option = field.config.options?.find((o) => o.id === value);
      if (!option) return <span className="text-muted-foreground text-sm">-</span>;
      return <SelectBadge option={option} />;
    }

    case "person": {
      const assigneeIds = Array.isArray(value) ? value : task.assigneeIds;
      if (assigneeIds.length === 0) {
        return <span className="text-muted-foreground text-sm">-</span>;
      }
      return <AvatarStack ids={assigneeIds} />;
    }

    case "date": {
      if (!value) return <span className="text-muted-foreground text-sm">-</span>;
      const overdue = field.id === SYSTEM_FIELD_IDS.DUE_DATE && isOverdue(value as string);
      return (
        <span className={cn("text-sm", overdue && "text-destructive")}>
          {formatDateShort(value as string)}
        </span>
      );
    }

    default:
      return (
        <span className="text-sm text-foreground truncate">
          {value?.toString() || "-"}
        </span>
      );
  }
}

function SelectBadge({ option }: { option: SelectOption }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: `${option.color}15`,
        color: option.color,
      }}
    >
      {option.label}
    </span>
  );
}

function AvatarStack({ ids }: { ids: string[] }) {
  return <SubjectAvatarStack subjectIds={ids} maxDisplay={3} size="sm" />;
}

// ===== Utilities =====

function getFieldValue(task: Task, fieldId: string): unknown {
  switch (fieldId) {
    case SYSTEM_FIELD_IDS.STATUS:
      return task.status;
    case SYSTEM_FIELD_IDS.PRIORITY:
      return task.priority;
    case SYSTEM_FIELD_IDS.ASSIGNEE:
      return task.assigneeIds;
    case SYSTEM_FIELD_IDS.START_DATE:
      return task.startDate;
    case SYSTEM_FIELD_IDS.DUE_DATE:
      return task.dueDate;
    default:
      return task.fieldValues[fieldId];
  }
}

function getColumnWidth(field: FieldDefinition): number {
  const defaultWidth = TABLE_COLUMNS.DEFAULT_WIDTHS[field.type];
  return defaultWidth || 150;
}

