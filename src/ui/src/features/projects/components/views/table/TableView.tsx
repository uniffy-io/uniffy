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
  type DragMoveEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowCounterClockwise,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  CaretDown,
  DotsSixVertical,
  CheckCircle,
  ArrowBendDownRight,
  EyeSlash,
  Eye,
  Columns,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { popoverShellClass } from "@/components/ui/popover";
import {
  selectCurrentProject,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import {
  selectSelectedTaskIds,
  selectSearchQuery,
  selectTask,
  toggleTaskSelection,
  selectAllTasks,
  clearSelection,
  openDetailPanel,
  openCreateTaskModal,
  setEditingCell,
  selectEditingCell,
  setFocusedCell,
  selectFocusedCell,
  pushUndo,
  popUndo,
  popRedo,
  selectUndoStack,
  selectRedoStack,
  selectOutlineExpanded,
  toggleOutlineRow,
  expandOutlineRow,
} from "@/features/projects/store/projectsUiSlice";
import { selectActiveDefinition } from "@/features/projects/store/viewSelectors";
import {
  setDraftColumnWidth,
  setDraftSort,
  setDraftVisibleFields,
  toggleDraftCollapsedGroup,
} from "@/features/projects/store/viewDraftThunks";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { useTaskGroups } from "@/features/projects/hooks/useTaskGroups";
import { groupSums } from "@/features/projects/utils/groupTasks";
import {
  GroupHeaderLabel,
  GroupHeaderStats,
} from "@/features/projects/components/views/GroupHeaderLabel";
import { moveTask } from "@/features/projects/store/projectsThunks";
import { LAYOUT, TABLE_COLUMNS } from "@/features/projects/constants";
import { statusPaint, type StatusPaint } from "@/features/projects/utils/statusPaint";
import { TaskParentChip } from "@/features/projects/components/TaskParentChip";
import { BlockedBadge } from "@/features/projects/components/BlockedBadge";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, FieldDefinition, SelectOption } from "@/features/projects/types";
import { SubjectAvatarStack, SubjectPicker } from "@/components/subject";
import { TagChip } from "@/features/tags";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { EmptyState } from "./EmptyState";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { parseMultiSelectValue } from "@/features/projects/utils/multiSelectParsers";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";
import { checkReparent } from "@/features/projects/utils/reparent";
import { getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import { toast } from "sonner";
import { SortDirection, TaskPseudoField } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewColumnWidth, ViewFieldRef } from "@/features/projects/types/views";
import {
  capabilitiesOf,
  fieldRef,
  pseudoRef,
  sameFieldRef,
} from "@/features/projects/utils/viewFields";
import { useViewCatalog } from "@/features/projects/hooks/useViewCatalog";
import {
  isFieldVisible,
  toggleSortKey,
  toggleVisibleField,
} from "@/features/projects/utils/viewDraft";

type RowDropZone = "before" | "reparent" | "after";
interface DropIndicator {
  overId: string;
  zone: RowDropZone;
}

const MAX_SUBTASK_DEPTH = 5;

export function TableView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const searchQuery = useAppSelector(selectSearchQuery);
  const projectId = project?.id ?? "";
  const fieldsById = useMemo(
    () => new Map(project?.fieldDefinitions.map((field) => [field.id, field])),
    [project?.fieldDefinitions],
  );
  const viewCatalog = useViewCatalog();
  const definition = useAppSelector(selectActiveDefinition(projectId));
  const sortKeys = definition.sort;
  const groupBy = definition.groupBy;
  const { canEdit } = useProjectPermission();
  const editingCell = useAppSelector(selectEditingCell);
  const focusedCell = useAppSelector(selectFocusedCell);
  const undoStack = useAppSelector(selectUndoStack);
  const redoStack = useAppSelector(selectRedoStack);
  const allTasks = useAppSelector((state) => state.projects.tasks);
  const outlineEnabled = definition.layout.type === "table" && !definition.layout.flat;
  const filteredTasks = useFilteredTasks(projectId, {
    includeSubtasks: !outlineEnabled,
  });
  const columnWidths = useMemo(
    () => columnWidthsByKey(definition.columnWidths),
    [definition.columnWidths],
  );
  const collapsedGroups = useMemo(
    () => new Set(definition.collapsedGroupKeys),
    [definition.collapsedGroupKeys],
  );
  // Expanded outline rows are the viewer's own row state; they survive a reload but never dirty a view.
  const expandedRows = useAppSelector(selectOutlineExpanded(projectId));
  const expandedRowSet = useMemo(() => new Set(expandedRows), [expandedRows]);
  const isParentExpanded = useCallback(
    (taskId: string) => expandedRowSet.has(taskId),
    [expandedRowSet],
  );
  const toggleParentExpand = useCallback(
    (taskId: string) => dispatch(toggleOutlineRow({ projectId, taskId })),
    [dispatch, projectId],
  );
  const markParentExpanded = useCallback(
    (taskId: string) => dispatch(expandOutlineRow({ projectId, taskId })),
    [dispatch, projectId],
  );
  // Track create field dialog
  const [isColumnsMenuOpen, setIsColumnsMenuOpen] = useState(false);
  // Track known task IDs so we can detect newly created subtasks
  const knownTaskIdsRef = useRef<Set<string>>(new Set());
  const hasSeededKnownTasksRef = useRef(false);

  // Auto-expand a parent when the user creates a new subtask in this session.
  // Bulk arrivals (initial fetch, project switch) bring many tasks at once;
  // those are skipped so we don't clobber the persisted collapse state.
  useEffect(() => {
    const currentIds = new Set(Object.keys(allTasks));
    if (!hasSeededKnownTasksRef.current) {
      knownTaskIdsRef.current = currentIds;
      hasSeededKnownTasksRef.current = true;
      return;
    }
    const known = knownTaskIdsRef.current;
    const newIds: string[] = [];
    for (const id of currentIds) {
      if (!known.has(id)) newIds.push(id);
    }
    if (newIds.length === 1) {
      const task = allTasks[newIds[0]];
      if (task?.parentId) markParentExpanded(task.parentId);
    }
    knownTaskIdsRef.current = currentIds;
  }, [allTasks, markParentExpanded]);

  // All non-title fields for the column menu (including hidden ones).
  // The unified-tags Tags column is appended as a synthetic field so the
  // user can hide it via the existing column visibility menu.
  const allNonTitleFields = useMemo(() => {
    if (!project) return [];
    const real = project.fieldDefinitions.filter((f) => f.id !== SYSTEM_FIELD_IDS.TITLE);
    return [...real, TAGS_VIRTUAL_FIELD];
  }, [project]);

  // A view that lists its fields shows them in its own order; one that lists none shows them all.
  const visibleFields = useMemo(() => {
    const listed = definition.visibleFields;
    if (listed.length === 0) return allNonTitleFields;
    return listed
      .map((ref) => allNonTitleFields.find((field) => sameFieldRef(columnRef(field.id), ref)))
      .filter((field): field is FieldDefinition => field !== undefined);
  }, [allNonTitleFields, definition.visibleFields]);
  const allColumnRefs = useMemo(
    () => [fieldRef(SYSTEM_FIELD_IDS.TITLE), ...allNonTitleFields.map((f) => columnRef(f.id))],
    [allNonTitleFields],
  );
  const setColumnVisible = useCallback(
    (fieldId: string, show: boolean) => {
      dispatch(
        setDraftVisibleFields(
          projectId,
          toggleVisibleField(definition.visibleFields, columnRef(fieldId), allColumnRefs, show),
        ),
      );
    },
    [dispatch, projectId, definition.visibleFields, allColumnRefs],
  );

  const { groups } = useTaskGroups(projectId, filteredTasks, groupBy);
  const summedFields = useMemo(
    () => visibleFields.filter((field) => field.type === "number"),
    [visibleFields],
  );

  // All tasks for select-all (respects grouping collapsed state)
  const allVisibleTaskIds = useMemo(() => {
    if (!groups) return filteredTasks.map((t) => t.id);
    return groups.flatMap((g) => g.tasks.map((t) => t.id));
  }, [groups, filteredTasks]);

  // Ordered task IDs for keyboard navigation (excludes collapsed groups)
  const orderedTaskIds = useMemo(() => {
    if (!groups) return filteredTasks.map((t) => t.id);
    return groups.flatMap((g) => (collapsedGroups.has(g.key) ? [] : g.tasks.map((t) => t.id)));
  }, [groups, filteredTasks, collapsedGroups]);

  // Ordered field IDs for keyboard navigation (title + visible fields)
  const orderedFieldIds = useMemo(() => {
    return [SYSTEM_FIELD_IDS.TITLE, ...visibleFields.map((f) => f.id)];
  }, [visibleFields]);

  // Resolved widths for the two system columns (id, title)
  const idColumnWidth = resolveSystemColumnWidth(
    ID_COLUMN_KEY,
    columnWidths,
    TABLE_COLUMNS.ID_WIDTH,
  );
  const titleColumnWidth = resolveSystemColumnWidth(TITLE_COLUMN_KEY, columnWidths, 300);

  // Compute total table width for horizontal scroll
  const totalTableWidth = useMemo(() => {
    const dragCol = 28;
    const checkboxCol = TABLE_COLUMNS.CHECKBOX_WIDTH;
    const fieldCols = visibleFields.reduce(
      (sum, f) => sum + resolveColumnWidth(f, columnWidths),
      0,
    );
    const columnsMenuCol = 40;
    return dragCol + checkboxCol + idColumnWidth + titleColumnWidth + fieldCols + columnsMenuCol;
  }, [visibleFields, columnWidths, idColumnWidth, titleColumnWidth]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

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
          const undoPayload = {
            id: entry.taskId,
            ...entry.previousValues,
          } as Partial<Task> & { id: string };
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
          const redoPayload = {
            id: entry.taskId,
            ...entry.newValues,
          } as Partial<Task> & { id: string };
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
              dispatch(
                setFocusedCell({
                  taskId: orderedTaskIds[0],
                  fieldId: orderedFieldIds[0],
                }),
              );
            }
            return;
          }
          const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
          if (rowIdx < orderedTaskIds.length - 1) {
            dispatch(
              setFocusedCell({
                taskId: orderedTaskIds[rowIdx + 1],
                fieldId: focusedCell.fieldId,
              }),
            );
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (!focusedCell) {
            if (orderedTaskIds.length > 0 && orderedFieldIds.length > 0) {
              dispatch(
                setFocusedCell({
                  taskId: orderedTaskIds[orderedTaskIds.length - 1],
                  fieldId: orderedFieldIds[0],
                }),
              );
            }
            return;
          }
          const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
          if (rowIdx > 0) {
            dispatch(
              setFocusedCell({
                taskId: orderedTaskIds[rowIdx - 1],
                fieldId: focusedCell.fieldId,
              }),
            );
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (!focusedCell) return;
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (colIdx < orderedFieldIds.length - 1) {
            dispatch(
              setFocusedCell({
                taskId: focusedCell.taskId,
                fieldId: orderedFieldIds[colIdx + 1],
              }),
            );
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (!focusedCell) return;
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (colIdx > 0) {
            dispatch(
              setFocusedCell({
                taskId: focusedCell.taskId,
                fieldId: orderedFieldIds[colIdx - 1],
              }),
            );
          }
          break;
        }
        case "Tab": {
          if (!focusedCell) return;
          e.preventDefault();
          const colIdx = orderedFieldIds.indexOf(focusedCell.fieldId);
          if (e.shiftKey) {
            if (colIdx > 0) {
              dispatch(
                setFocusedCell({
                  taskId: focusedCell.taskId,
                  fieldId: orderedFieldIds[colIdx - 1],
                }),
              );
            } else {
              const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
              if (rowIdx > 0) {
                dispatch(
                  setFocusedCell({
                    taskId: orderedTaskIds[rowIdx - 1],
                    fieldId: orderedFieldIds[orderedFieldIds.length - 1],
                  }),
                );
              }
            }
          } else {
            if (colIdx < orderedFieldIds.length - 1) {
              dispatch(
                setFocusedCell({
                  taskId: focusedCell.taskId,
                  fieldId: orderedFieldIds[colIdx + 1],
                }),
              );
            } else {
              const rowIdx = orderedTaskIds.indexOf(focusedCell.taskId);
              if (rowIdx < orderedTaskIds.length - 1) {
                dispatch(
                  setFocusedCell({
                    taskId: orderedTaskIds[rowIdx + 1],
                    fieldId: orderedFieldIds[0],
                  }),
                );
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
            dispatch(
              setEditingCell({
                taskId: focusedCell.taskId,
                fieldId: focusedCell.fieldId,
              }),
            );
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

  const handleRowClick = useCallback(
    (taskId: string, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        dispatch(toggleTaskSelection(taskId));
      } else {
        dispatch(selectTask(taskId));
        dispatch(openDetailPanel());
      }
    },
    [dispatch],
  );

  const handleCheckboxClick = useCallback(
    (taskId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch(toggleTaskSelection(taskId));
    },
    [dispatch],
  );

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

  // Click sorts by this column alone; shift-click adds it as a further key.
  const handleHeaderClick = useCallback(
    (fieldId: string, e: React.MouseEvent) => {
      if (!capabilitiesOf(columnRef(fieldId), fieldsById, viewCatalog)?.sortable) return;
      dispatch(setDraftSort(projectId, toggleSortKey(sortKeys, columnRef(fieldId), e.shiftKey)));
    },
    [dispatch, projectId, fieldsById, viewCatalog, sortKeys],
  );

  const handleStartEdit = useCallback(
    (taskId: string, fieldId: string) => {
      if (!canEdit) return;
      dispatch(setEditingCell({ taskId, fieldId }));
    },
    [dispatch, canEdit],
  );

  const handleEndEdit = useCallback(() => {
    dispatch(setEditingCell(null));
  }, [dispatch]);

  const handleSaveField = useCallback(
    (taskId: string, fieldId: string, value: unknown) => {
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
      dispatch(
        pushUndo({
          id: `undo-${Date.now()}`,
          actionType: "updateField",
          taskId,
          previousValues,
          newValues,
          timestamp: Date.now(),
          description: `Changed ${fieldId} of ${task?.title ?? taskId}`,
        }),
      );

      dispatch(optimisticUpdateTask(update));
      dispatch(updateTask(update));
      // Don't close editing cell for multi-select fields (assignee picker stays open)
      if (fieldId !== SYSTEM_FIELD_IDS.ASSIGNEE) {
        dispatch(setEditingCell(null));
      }
    },
    [dispatch, allTasks, canEdit],
  );

  const toggleGroup = useCallback(
    (groupKey: string) => dispatch(toggleDraftCollapsedGroup(projectId, groupKey)),
    [dispatch, projectId],
  );

  const handleCellClick = useCallback(
    (taskId: string, fieldId: string) => {
      dispatch(setFocusedCell({ taskId, fieldId }));
    },
    [dispatch],
  );

  const handleTitleClick = useCallback(
    (taskId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch(selectTask(taskId));
      dispatch(openDetailPanel());
    },
    [dispatch],
  );

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const allTasksList = useMemo(() => Object.values(allTasks), [allTasks]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    if (!activeTask) return;
    const onPointerMove = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [activeTask]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = filteredTasks.find((t) => t.id === event.active.id);
      if (task) setActiveTask(task);
    },
    [filteredTasks],
  );

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      if (dropIndicatorRef.current !== null) {
        dropIndicatorRef.current = null;
        setDropIndicator(null);
      }
      return;
    }

    const overRect = over.rect;
    if (!overRect) return;

    const pointerY =
      pointerYRef.current ??
      (active.rect.current.translated
        ? active.rect.current.translated.top + active.rect.current.translated.height / 2
        : null);
    if (pointerY === null) return;

    const ratio = (pointerY - overRect.top) / overRect.height;
    const zone: RowDropZone = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "reparent";
    const overId = over.id as string;

    const next: DropIndicator = { overId, zone };
    const prev = dropIndicatorRef.current;
    if (!prev || prev.overId !== next.overId || prev.zone !== next.zone) {
      dropIndicatorRef.current = next;
      setDropIndicator(next);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const indicator = dropIndicatorRef.current;
      setActiveTask(null);
      setDropIndicator(null);
      dropIndicatorRef.current = null;

      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      const overId = over.id as string;
      const activeTaskRow = filteredTasks.find((t) => t.id === activeId);
      if (!activeTaskRow) return;

      const overTask = allTasks[overId];
      if (!overTask) return;

      const zone: RowDropZone = indicator?.overId === overId ? indicator.zone : "reparent";

      if (zone === "reparent") {
        const check = checkReparent(activeId, overId, allTasksList, activeTaskRow.parentId);
        if (!check.ok) return;
        const warning = getHierarchyRuleViolation(
          activeTaskRow.taskType || "task",
          overTask.taskType || "task",
        );
        dispatch(optimisticUpdateTask({ id: activeId, parentId: overId }));
        dispatch(updateTask({ id: activeId, parentId: overId }));
        if (warning) toast.warning(warning);
        return;
      }

      const activeIdx = orderedTaskIds.indexOf(activeId);
      const overIdx = orderedTaskIds.indexOf(overId);
      if (activeIdx === -1 || overIdx === -1) return;

      const orderedOver = filteredTasks[overIdx];
      const insertBefore = zone === "before";
      const direction = insertBefore ? -1 : 1;
      let neighborIdx = overIdx + direction;
      while (
        neighborIdx >= 0 &&
        neighborIdx < filteredTasks.length &&
        filteredTasks[neighborIdx].id === activeId
      ) {
        neighborIdx += direction;
      }
      const neighbor =
        neighborIdx >= 0 && neighborIdx < filteredTasks.length ? filteredTasks[neighborIdx] : null;

      let newSortOrder: number;
      if (insertBefore) {
        newSortOrder = neighbor
          ? (neighbor.sortOrder + orderedOver.sortOrder) / 2
          : orderedOver.sortOrder / 2;
      } else {
        newSortOrder = neighbor
          ? (orderedOver.sortOrder + neighbor.sortOrder) / 2
          : orderedOver.sortOrder + 10000;
      }

      if (newSortOrder === activeTaskRow.sortOrder) return;

      dispatch(optimisticUpdateTask({ id: activeId, sortOrder: newSortOrder }));
      dispatch(moveTask({ id: activeId, status: activeTaskRow.status, sortOrder: newSortOrder }));
    },
    [dispatch, orderedTaskIds, filteredTasks, allTasks, allTasksList],
  );

  const getSubtasksForParent = useCallback(
    (parentId: string): Task[] => {
      return Object.values(allTasks)
        .filter((t) => t.parentId === parentId && !t.deletedAt)
        .sort((a, b) => a.number - b.number);
    },
    [allTasks],
  );

  if (!project) {
    return null;
  }

  if (filteredTasks.length === 0 && !searchQuery) {
    return <EmptyState onCreateTask={canEdit ? handleAddTask : undefined} />;
  }

  const renderSubtaskRow = (task: Task, depth: number = 1): React.ReactNode => {
    const hasChildren = task.subtaskTotal > 0 && depth < MAX_SUBTASK_DEPTH;
    const isExp = isParentExpanded(task.id);
    const childSubtasks = isExp ? getSubtasksForParent(task.id) : [];
    const rowZone = dropIndicator?.overId === task.id ? dropIndicator.zone : null;

    return (
      <div key={task.id}>
        <TableRow
          task={task}
          fields={visibleFields}
          columnWidths={columnWidths}
          idColumnWidth={idColumnWidth}
          titleColumnWidth={titleColumnWidth}
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
          dropZone={rowZone}
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
    const expandable = outlineEnabled && hasSubtasks;
    const isExpanded = expandable && isParentExpanded(task.id);
    const subtasks = isExpanded ? getSubtasksForParent(task.id) : [];
    const rowZone = dropIndicator?.overId === task.id ? dropIndicator.zone : null;

    return (
      <div key={task.id}>
        <SortableTableRow
          task={task}
          fields={visibleFields}
          columnWidths={columnWidths}
          idColumnWidth={idColumnWidth}
          titleColumnWidth={titleColumnWidth}
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
          expandable={expandable}
          isExpanded={isExpanded}
          collapsedSubtaskCount={expandable && !isExpanded ? task.subtaskTotal : 0}
          onToggleExpand={() => toggleParentExpand(task.id)}
          dropZone={rowZone}
        />
        {isExpanded && subtasks.map((child) => renderSubtaskRow(child, 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Scrollable Table (header + body scroll together horizontally) */}
      <ScrollArea className="flex-1">
        <div style={{ minWidth: totalTableWidth }}>
          {/* Table Header (sticky for vertical scroll) */}
          <div
            className="sticky top-0 z-10 flex items-center border-b border-border bg-muted"
            style={{ height: LAYOUT.TABLE_HEADER_HEIGHT }}
          >
            {/* Drag Handle Column */}
            <div className="shrink-0 border-r border-border bg-muted/30" style={{ width: 28 }} />

            {/* Checkbox Column */}
            <div
              className="shrink-0 flex items-center justify-center border-r border-border bg-muted/30"
              style={{ width: TABLE_COLUMNS.CHECKBOX_WIDTH }}
            >
              <Checkbox
                size="sm"
                aria-label="Select all tasks"
                checked={
                  allVisibleTaskIds.length > 0 &&
                  selectedTaskIds.length === allVisibleTaskIds.length
                }
                indeterminate={
                  selectedTaskIds.length > 0 && selectedTaskIds.length < allVisibleTaskIds.length
                }
                onChange={handleSelectAll}
              />
            </div>

            {/* ID Column */}
            <div
              className="shrink-0 flex items-center px-3 border-r border-border select-none relative"
              style={{ width: idColumnWidth }}
            >
              <span className="text-xs font-medium text-muted-foreground">ID</span>
              {project && (
                <ColumnResizeHandle
                  columnKey={ID_COLUMN_KEY}
                  projectId={project.id}
                  currentWidth={idColumnWidth}
                  minWidth={80}
                />
              )}
            </div>

            {/* Title Column */}
            <div
              className="shrink-0 flex items-center px-3 border-r border-border cursor-pointer hover:bg-muted/30 transition-colors select-none relative"
              style={{ width: titleColumnWidth }}
              onClick={(e) => handleHeaderClick(SYSTEM_FIELD_IDS.TITLE, e)}
            >
              <span className="text-xs font-medium text-muted-foreground flex-1">Title</span>
              <SortIndicator sortKeys={sortKeys} columnKey={SYSTEM_FIELD_IDS.TITLE} />
              {project && (
                <ColumnResizeHandle
                  columnKey={TITLE_COLUMN_KEY}
                  projectId={project.id}
                  currentWidth={titleColumnWidth}
                  minWidth={150}
                />
              )}
            </div>

            {/* Field Columns */}
            {visibleFields.map((field) => (
              <div
                key={field.id}
                className={cn(
                  "shrink-0 flex items-center px-3 border-r border-border transition-colors select-none group relative",
                  capabilitiesOf(columnRef(field.id), fieldsById, viewCatalog)?.sortable &&
                    "cursor-pointer hover:bg-muted/30",
                )}
                style={{ width: resolveColumnWidth(field, columnWidths) }}
                onClick={(e) => handleHeaderClick(field.id, e)}
              >
                <span className="text-xs font-medium text-muted-foreground flex-1 truncate">
                  {field.name}
                </span>
                <SortIndicator sortKeys={sortKeys} columnKey={field.id} />
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground ml-1 shrink-0"
                  title="Hide column"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColumnVisible(field.id, false);
                  }}
                >
                  <EyeSlash size={12} />
                </button>
                {/* Resize handle */}
                {project && (
                  <ColumnResizeHandle
                    columnKey={field.id}
                    projectId={project.id}
                    currentWidth={resolveColumnWidth(field, columnWidths)}
                  />
                )}
              </div>
            ))}

            {/* Columns Visibility Button */}
            <div className="shrink-0 flex items-center px-2 relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Show/hide columns"
                onClick={() => setIsColumnsMenuOpen(!isColumnsMenuOpen)}
              >
                <Columns size={14} className="text-muted-foreground" />
              </Button>
              {isColumnsMenuOpen && project && (
                <ColumnsVisibilityMenu
                  allFields={allNonTitleFields}
                  isVisible={(fieldId) =>
                    isFieldVisible(definition.visibleFields, columnRef(fieldId))
                  }
                  onToggle={setColumnVisible}
                  onClose={() => setIsColumnsMenuOpen(false)}
                />
              )}
            </div>
          </div>

          {/* Table Body */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
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
                        {isCollapsed ? (
                          <CaretRight size={14} className="text-muted-foreground shrink-0" />
                        ) : (
                          <CaretDown size={14} className="text-muted-foreground shrink-0" />
                        )}
                        <GroupHeaderLabel group={group} className="shrink min-w-0" />
                        <GroupHeaderStats
                          count={group.tasks.length}
                          sums={groupSums(group.tasks, summedFields)}
                        />
                      </div>

                      {/* Group Tasks - each group has its own sortable context */}
                      {!isCollapsed && (
                        <SortableContext
                          items={groupTaskIds}
                          strategy={verticalListSortingStrategy}
                        >
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

              {canEdit && (
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
              )}
            </div>

            {/* Drag Overlay */}
            <DragOverlay>
              {activeTask && (
                <div
                  className={cn(popoverShellClass, "flex items-center rounded opacity-90")}
                  style={{ height: LAYOUT.TABLE_ROW_HEIGHT }}
                >
                  <div className="shrink-0 flex items-center justify-center" style={{ width: 28 }}>
                    <DotsSixVertical size={14} className="text-muted-foreground" />
                  </div>
                  <div className="px-3 text-sm text-foreground truncate">{activeTask.title}</div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </ScrollArea>

      {/* Floating Undo/Redo pill */}
      {(undoStack.length > 0 || redoStack.length > 0) && (
        <div
          className={cn(
            popoverShellClass,
            "absolute bottom-4 right-4 flex items-center gap-1 px-2 py-1.5 z-10",
          )}
        >
          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={() => {
              if (undoStack.length > 0) {
                const entry = undoStack[undoStack.length - 1];
                const payload = {
                  id: entry.taskId,
                  ...entry.previousValues,
                } as Partial<Task> & { id: string };
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
                const payload = {
                  id: entry.taskId,
                  ...entry.newValues,
                } as Partial<Task> & { id: string };
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

interface TableRowProps {
  task: Task;
  fields: FieldDefinition[];
  columnWidths: Record<string, number>;
  idColumnWidth: number;
  titleColumnWidth: number;
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
  collapsedSubtaskCount?: number;
  onToggleExpand?: () => void;
  dropZone?: RowDropZone | null;
}

function SortableTableRow(
  props: Omit<TableRowProps, "dragHandleProps" | "isDragging" | "style" | "rowRef">,
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });

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
  columnWidths,
  idColumnWidth,
  titleColumnWidth,
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
  collapsedSubtaskCount = 0,
  onToggleExpand,
  dropZone,
}: TableRowProps) {
  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center border-b border-border cursor-pointer relative",
        "hover:bg-muted/30 transition-colors",
        isSelected && "bg-primary/5",
        isDragging && "bg-muted/50",
        isSubtask && "bg-muted/10",
        dropZone === "reparent" && "bg-primary/10 ring-2 ring-primary/50 ring-inset",
      )}
      style={{ height: LAYOUT.TABLE_ROW_HEIGHT, ...style }}
      onClick={onClick}
    >
      {/* Selection Indicator */}
      {isSelected && <div className="absolute left-0 w-0.5 h-full bg-primary" />}
      {dropZone === "before" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary pointer-events-none" />
      )}
      {dropZone === "after" && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary pointer-events-none" />
      )}

      {/* Drag Handle / Subtask indent */}
      <div
        className={cn(
          "shrink-0 flex items-center justify-center",
          isSubtask
            ? "text-muted-foreground/30"
            : "cursor-grab active:cursor-grabbing text-subtle-foreground hover:text-muted-foreground",
        )}
        style={{ width: 28 }}
        {...(isSubtask ? {} : dragHandleProps)}
        onClick={(e) => e.stopPropagation()}
      >
        {isSubtask ? (
          <ArrowBendDownRight size={12} className="text-subtle-foreground" />
        ) : (
          <DotsSixVertical size={14} />
        )}
      </div>

      {/* Checkbox Column */}
      <div
        className="shrink-0 flex items-center justify-center border-r border-border"
        style={{ width: TABLE_COLUMNS.CHECKBOX_WIDTH }}
      >
        <Checkbox
          size="sm"
          aria-label={`Select ${task.title}`}
          checked={isSelected}
          onChange={() => {}}
          onClick={onCheckboxClick}
        />
      </div>

      {/* ID Column */}
      <div
        className="shrink-0 flex items-center px-3 border-r border-border overflow-hidden"
        style={{ width: idColumnWidth }}
        onClick={onTitleClick}
      >
        <TaskIdCell task={task} />
      </div>

      {/* Title Column - single click opens detail panel */}
      <div
        className={cn(
          "shrink-0 flex items-center border-r border-border overflow-hidden",
          focusedFieldId === SYSTEM_FIELD_IDS.TITLE && "ring-2 ring-inset ring-primary",
          !isSubtask && "px-3",
        )}
        style={{
          width: titleColumnWidth,
          ...(isSubtask ? { paddingLeft: 24 + (subtaskDepth ?? 1) * 16, paddingRight: 12 } : {}),
        }}
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
            {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          </button>
        )}
        {task.subtaskTotal > 0 && (
          <span className="mr-1.5 flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <CheckCircle
              size={10}
              className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""}
            />
            {task.subtaskCompleted}/{task.subtaskTotal}
          </span>
        )}
        {collapsedSubtaskCount > 0 && (
          <span
            className="mr-1.5 text-[10px] text-muted-foreground shrink-0"
            title={`${collapsedSubtaskCount} subtask${collapsedSubtaskCount === 1 ? "" : "s"} hidden`}
          >
            +{collapsedSubtaskCount}
          </span>
        )}
        <TaskTitleCell task={task} showParent={!isSubtask} />
      </div>

      {/* Field Columns */}
      {fields.map((field) => {
        if (field.id === TAGS_COLUMN_KEY) {
          return (
            <div
              key={field.id}
              className={cn(
                "shrink-0 flex items-center px-3 border-r border-border relative overflow-hidden",
                focusedFieldId === field.id && "ring-2 ring-inset ring-primary",
              )}
              style={{ width: resolveColumnWidth(field, columnWidths) }}
              onClick={(e) => {
                e.stopPropagation();
                onCellClick(field.id);
              }}
            >
              <TagsRowCell task={task} />
            </div>
          );
        }
        const isDropdownOpen =
          editingFieldId === field.id &&
          (field.type === "single_select" ||
            field.type === "multi_select" ||
            field.type === "date" ||
            field.type === "person");
        return (
          <div
            key={field.id}
            className={cn(
              "shrink-0 flex items-center px-3 border-r border-border relative",
              isDropdownOpen ? "overflow-visible" : "overflow-hidden",
              focusedFieldId === field.id && "ring-2 ring-inset ring-primary",
            )}
            style={{ width: resolveColumnWidth(field, columnWidths) }}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick(field.id);
            }}
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

interface EditableFieldCellProps {
  task: Task;
  field: FieldDefinition;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onSave: (value: unknown) => void;
}

function EditableFieldCell({
  task,
  field,
  isEditing,
  onStartEdit,
  onEndEdit,
  onSave,
}: EditableFieldCellProps) {
  const isSelectField = field.type === "single_select";
  const isMultiSelectField = field.type === "multi_select";
  const isDateField = field.type === "date";
  const isPersonField = field.type === "person";

  // Select fields: badge + caret trigger, dropdown appears below when editing
  if (isSelectField) {
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onStartEdit();
        }}
      >
        <FieldCell task={task} field={field} />
        <CaretDown size={12} className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineSelectEditor
            options={field.config.options ?? []}
            swatch={
              field.id === SYSTEM_FIELD_IDS.STATUS
                ? (o) => statusPaint(field.config.options ?? [], o.id).gradient
                : undefined
            }
            currentValue={String(getTaskFieldValue(task, field.id) ?? "")}
            onSave={onSave}
            onClose={onEndEdit}
          />
        )}
      </div>
    );
  }

  // Multi-select fields: badge chips + caret trigger, dropdown appears below when editing
  if (isMultiSelectField) {
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onStartEdit();
        }}
      >
        <FieldCell task={task} field={field} />
        <CaretDown size={12} className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineMultiSelectEditor
            options={field.config.options ?? []}
            currentValue={parseMultiSelectValue(getTaskFieldValue(task, field.id))}
            onSave={(ids) => onSave(ids.length > 0 ? ids : null)}
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
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onStartEdit();
        }}
      >
        <FieldCell task={task} field={field} />
        <CaretDown size={12} className="text-muted-foreground shrink-0 ml-1" />
        {isEditing && (
          <InlineDateEditor
            currentValue={String(getTaskFieldValue(task, field.id) ?? "")}
            onSave={onSave}
            onClose={onEndEdit}
          />
        )}
      </div>
    );
  }

  // Person fields: avatar stack + "+" trigger, assignee picker appears below when editing
  if (isPersonField) {
    const assigneeIds = toIdList(getTaskFieldValue(task, field.id));
    return (
      <div
        className="w-full h-full flex items-center justify-between cursor-pointer relative"
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onStartEdit();
        }}
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
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit();
        }}
      >
        <FieldCell task={task} field={field} />
      </div>
    );
  }

  const value = getTaskFieldValue(task, field.id);

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

function InlineTextInput({
  initialValue,
  type,
  onSave,
  onCancel,
}: {
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

function InlineSelectEditor({
  options,
  currentValue,
  onSave,
  onClose,
  swatch,
}: {
  options: SelectOption[];
  currentValue: string;
  onSave: (value: unknown) => void;
  onClose: () => void;
  /** Overrides the stored option colour for the swatch (statuses derive theirs from order). */
  swatch?: (option: SelectOption) => string;
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
      className={cn(
        popoverShellClass,
        "absolute top-full left-0 z-50 mt-1 min-w-35 py-1 max-h-48 overflow-y-auto",
      )}
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
            option.id === currentValue
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted",
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: swatch ? swatch(option) : option.color }}
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InlineMultiSelectEditor({
  options,
  currentValue,
  onSave,
  onClose,
}: {
  options: SelectOption[];
  currentValue: string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(currentValue));

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onSave([...selected]);
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, onSave, selected]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  return (
    <div
      ref={dropdownRef}
      className={cn(
        popoverShellClass,
        "absolute top-full left-0 z-50 mt-1 min-w-35 py-1 max-h-48 overflow-y-auto",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((option) => {
        const isSelected = selected.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => toggle(option.id)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
              isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
            )}
          >
            <span
              className={cn(
                "w-3.5 h-3.5 rounded-sm border shrink-0 flex items-center justify-center",
                isSelected ? "bg-primary border-primary" : "border-border",
              )}
            >
              {isSelected && (
                <span className="text-primary-foreground text-[10px] font-bold">&#10003;</span>
              )}
            </span>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: option.color }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function InlineDateEditor({
  currentValue,
  onSave,
  onClose,
}: {
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

  const [displayMonth, setDisplayMonth] = useState<Date>(() => selectedDate || new Date());

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
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useOverlayEscape(onClose);

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
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const today = new Date();

  const dropdown = position
    ? createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: position.top, left: position.left, width: 280 }}
          className={cn(popoverShellClass, "z-200")}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <button
              type="button"
              onClick={() =>
                setDisplayMonth(
                  new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1),
                )
              }
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            <span className="text-sm font-medium text-foreground">
              {displayMonth.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                setDisplayMonth(
                  new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1),
                )
              }
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
                    !isCurrentMonth && "text-subtle-foreground",
                    isCurrentMonth && !isSelected && "text-foreground hover:bg-muted",
                    isCurrentDay && !isSelected && "font-semibold text-primary",
                    isSelected && "bg-primary text-primary-foreground font-medium",
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
                onClick={() => {
                  onSave(null);
                  onClose();
                }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={triggerRef} className="absolute top-0 left-0 w-full h-full" />
      {dropdown}
    </>
  );
}

function InlineAssigneeEditor({
  currentAssigneeIds,
  onSave,
  onClose,
}: {
  currentAssigneeIds: string[];
  onSave: (value: unknown) => void;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback(
    (ids: string[]) => {
      onSave(ids);
    },
    [onSave],
  );

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

function TaskIdCell({ task }: { task: Task }) {
  const project = useAppSelector(selectCurrentProject);
  const ticketId = `${project?.slug || ""}-${task.number}`;

  return (
    <div className="flex items-center min-w-0">
      <span className="text-xs font-mono text-muted-foreground truncate">{ticketId}</span>
    </div>
  );
}

/** `showParent` is off for outline rows, which already sit under their parent. */
function TaskTitleCell({ task, showParent }: { task: Task; showParent: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {showParent && <TaskParentChip task={task} className="text-xs max-w-[120px]" />}
      <TaskTypeIcon type={task.taskType} className="text-muted-foreground" />
      <span className="truncate text-foreground text-sm">{task.title}</span>
      <BlockedBadge task={task} variant="icon" />
    </div>
  );
}

interface FieldCellProps {
  task: Task;
  field: FieldDefinition;
}

function FieldCell({ task, field }: FieldCellProps) {
  const value = getTaskFieldValue(task, field.id);

  switch (field.type) {
    case "single_select": {
      const option = field.config.options?.find((o) => o.id === value);
      if (!option) return <span className="text-muted-foreground text-sm">-</span>;
      return (
        <SelectBadge
          option={option}
          paint={
            field.id === SYSTEM_FIELD_IDS.STATUS
              ? statusPaint(field.config.options ?? [], option.id)
              : undefined
          }
        />
      );
    }

    case "multi_select": {
      const selectedIds = parseMultiSelectValue(value);
      if (selectedIds.length === 0) return <span className="text-muted-foreground text-sm">-</span>;
      const selectedOptions = selectedIds
        .map((id) => field.config.options?.find((o) => o.id === id))
        .filter(Boolean) as SelectOption[];
      return (
        <div className="flex items-center gap-1 overflow-hidden">
          {selectedOptions.map((opt) => (
            <SelectBadge key={opt.id} option={opt} />
          ))}
        </div>
      );
    }

    case "person": {
      const personIds = toIdList(value);
      if (personIds.length === 0) {
        return <span className="text-muted-foreground text-sm">-</span>;
      }
      return <AvatarStack ids={personIds} />;
    }

    case "date": {
      if (!value) return <span className="text-muted-foreground text-sm">-</span>;
      const overdue =
        field.id === SYSTEM_FIELD_IDS.DUE_DATE && !task.completedAt && isOverdue(value as string);
      return (
        <span className={cn("text-sm", overdue && "text-destructive")}>
          {formatDateShort(value as string)}
        </span>
      );
    }

    default:
      return <span className="text-sm text-foreground truncate">{value?.toString() || "-"}</span>;
  }
}

function SelectBadge({ option, paint }: { option: SelectOption; paint?: StatusPaint }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: paint?.translucent ?? `${option.color}15`,
        color: paint?.solid ?? option.color,
      }}
    >
      {option.label}
    </span>
  );
}

function AvatarStack({ ids }: { ids: string[] }) {
  return <SubjectAvatarStack subjectIds={ids} maxDisplay={3} size="sm" />;
}

// Read-only tag chip row for the synthetic Tags column. Editing happens
// from the task detail panel, mirroring the read-only chip pattern from
// the files domain's list-view tag column.
function TagsRowCell({ task }: { task: Task }) {
  const tags = useTagsByIds(task.tagIds ?? []);
  if (tags.length === 0) {
    return <span className="text-xs text-subtle-foreground">-</span>;
  }
  const shown = tags.slice(0, 3);
  const overflow = tags.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 overflow-hidden">
      {shown.map((tag) => (
        <TagChip key={tag.id} tag={tag} nonInteractive className="px-1.5 py-0 text-[10px]" />
      ))}
      {overflow > 0 && (
        <span
          className="text-[10px] text-muted-foreground"
          title={tags
            .slice(3)
            .map((t) => t.name)
            .join(", ")}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

// Column keys of the table chrome; everything else is keyed by its field id.
const ID_COLUMN_KEY = "__id__";
const TITLE_COLUMN_KEY = SYSTEM_FIELD_IDS.TITLE;
const TAGS_COLUMN_KEY = "__tags__";

const TAGS_VIRTUAL_FIELD: FieldDefinition = {
  id: TAGS_COLUMN_KEY,
  projectId: "",
  name: "Tags",
  type: "text",
  isRequired: false,
  isSystem: true,
  sortOrder: 1000,
  config: {},
  createdAt: "",
  updatedAt: "",
};

/** The saved-view field a table column stands for: the ID column is the task number. */
function columnRef(columnKey: string): ViewFieldRef {
  if (columnKey === ID_COLUMN_KEY) return pseudoRef(TaskPseudoField.NUMBER);
  if (columnKey === TAGS_COLUMN_KEY) return pseudoRef(TaskPseudoField.TAGS);
  return fieldRef(columnKey);
}

function columnKeyOf(ref: ViewFieldRef): string | null {
  if (ref.kind === "field") return ref.fieldId;
  if (ref.pseudo === TaskPseudoField.NUMBER) return ID_COLUMN_KEY;
  if (ref.pseudo === TaskPseudoField.TAGS) return TAGS_COLUMN_KEY;
  return null;
}

function columnWidthsByKey(widths: readonly ViewColumnWidth[]): Record<string, number> {
  const byKey: Record<string, number> = {};
  for (const { field, width } of widths) {
    const key = columnKeyOf(field);
    if (key) byKey[key] = width;
  }
  return byKey;
}

function SortIndicator({
  sortKeys,
  columnKey,
}: {
  sortKeys: readonly { field: ViewFieldRef; direction: SortDirection }[];
  columnKey: string;
}) {
  const index = sortKeys.findIndex((key) => sameFieldRef(key.field, columnRef(columnKey)));
  if (index === -1) return null;
  const Arrow = sortKeys[index].direction === SortDirection.DESC ? ArrowDown : ArrowUp;
  return (
    <span className="flex items-center ml-1 shrink-0 text-primary">
      <Arrow size={12} />
      {sortKeys.length > 1 && <span className="text-[10px] font-medium">{index + 1}</span>}
    </span>
  );
}

function getDefaultColumnWidth(field: FieldDefinition): number {
  const defaultWidth = TABLE_COLUMNS.DEFAULT_WIDTHS[field.type];
  return defaultWidth || 150;
}

function resolveColumnWidth(field: FieldDefinition, widths: Record<string, number>): number {
  const stored = widths[field.id];
  if (typeof stored === "number" && stored > 0) return stored;
  return getDefaultColumnWidth(field);
}

function resolveSystemColumnWidth(
  columnKey: string,
  widths: Record<string, number>,
  defaultWidth: number,
): number {
  const stored = widths[columnKey];
  if (typeof stored === "number" && stored > 0) return stored;
  return defaultWidth;
}

interface ColumnsVisibilityMenuProps {
  allFields: FieldDefinition[];
  isVisible: (fieldId: string) => boolean;
  onToggle: (fieldId: string, show: boolean) => void;
  onClose: () => void;
}

function ColumnsVisibilityMenu({
  allFields,
  isVisible,
  onToggle,
  onClose,
}: ColumnsVisibilityMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className={cn(
        popoverShellClass,
        "absolute top-full right-0 z-50 mt-1 w-60 py-1 animate-in fade-in-0 zoom-in-95",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
        Columns
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {allFields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No columns available</div>
        )}
        {allFields.map((field) => {
          const visible = isVisible(field.id);
          return (
            <button
              key={field.id}
              type="button"
              onClick={() => onToggle(field.id, !visible)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted transition-colors"
            >
              <span className="truncate">{field.name}</span>
              {visible ? (
                <Eye size={14} className="text-muted-foreground shrink-0" />
              ) : (
                <EyeSlash size={14} className="text-subtle-foreground shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ColumnResizeHandleProps {
  columnKey: string;
  projectId: string;
  currentWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

function ColumnResizeHandle({
  columnKey,
  projectId,
  currentWidth,
  minWidth = TABLE_COLUMNS.MIN_COLUMN_WIDTH,
  maxWidth = 800,
}: ColumnResizeHandleProps) {
  const dispatch = useAppDispatch();
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(currentWidth);
  const latestWidthRef = useRef(currentWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;
      latestWidthRef.current = currentWidth;
      setIsResizing(true);
    },
    [currentWidth],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      if (nextWidth !== latestWidthRef.current) {
        latestWidthRef.current = nextWidth;
        dispatch(setDraftColumnWidth(projectId, columnRef(columnKey), nextWidth));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, dispatch, projectId, columnKey, minWidth, maxWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={cn(
        "absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none z-10",
        "hover:bg-primary/60 transition-colors",
        isResizing && "bg-primary",
      )}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
