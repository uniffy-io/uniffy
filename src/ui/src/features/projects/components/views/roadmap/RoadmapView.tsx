import { useState, useRef, useMemo, useCallback } from "react";
import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { startOfDay, format } from "date-fns";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
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
  openDetailPanel,
  openCreateTaskModal,
} from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { selectActiveDefinition } from "@/features/projects/store/viewSelectors";
import {
  setDraftLayout,
  toggleDraftCollapsedGroup,
} from "@/features/projects/store/viewDraftThunks";
import { useTaskGroups } from "@/features/projects/hooks/useTaskGroups";
import { RoadmapZoom } from "@uniffy/proto/projects/v1/projects_pb";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import type { Task } from "@/features/projects/types";
import type { ZoomLevel } from "@/features/projects/utils/ganttPositioning";
import {
  generateTimelineColumns,
  calculateBarPosition,
  addPeriods,
  getStartOfPeriod,
  COLUMN_WIDTHS,
} from "@/features/projects/utils/ganttPositioning";
import { LAYOUT } from "@/features/projects/constants";
import { RoadmapTaskList } from "./RoadmapTaskList";
import { buildGroupedRows, buildOrderedRows, type RoadmapRow } from "./roadmapRows";
import { TimelineGrid } from "./TimelineGrid";
import { GanttBar, EmptyGanttRow, GroupGanttRow, SummaryBar } from "./GanttBar";
import { DependencyLines } from "./DependencyLines";
import { EmptyState } from "../table/EmptyState";

// Number of periods to show in each direction from center
const PERIODS_BEFORE = 15;
const PERIODS_AFTER = 45;

interface RollupSpan {
  start: string;
  due: string;
}

/**
 * For each task with children, the min start / max due across all descendants
 * that carry dates. Drives the summary rollup bracket shown for parents that
 * lack their own dates. ISO date strings compare lexicographically.
 */
function computeRollupSpans(tasks: Task[]): Map<string, RollupSpan> {
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }

  const spans = new Map<string, RollupSpan>();
  const compute = (taskId: string, visiting: Set<string>): RollupSpan | null => {
    if (spans.has(taskId)) return spans.get(taskId)!;
    if (visiting.has(taskId)) return null;
    visiting.add(taskId);

    let minStart: string | null = null;
    let maxDue: string | null = null;
    const consider = (start: string | null, due: string | null) => {
      if (start && (minStart === null || start < minStart)) minStart = start;
      if (due && (maxDue === null || due > maxDue)) maxDue = due;
    };

    for (const kid of childrenByParent.get(taskId) ?? []) {
      consider(kid.startDate, kid.dueDate);
      const sub = compute(kid.id, visiting);
      if (sub) consider(sub.start, sub.due);
    }

    visiting.delete(taskId);
    if (minStart && maxDue) {
      const span: RollupSpan = { start: minStart, due: maxDue };
      spans.set(taskId, span);
      return span;
    }
    return null;
  };

  for (const t of tasks) {
    if (childrenByParent.has(t.id)) compute(t.id, new Set());
  }
  return spans;
}

const ZOOM_LEVELS: Record<RoadmapZoom, ZoomLevel> = {
  [RoadmapZoom.UNSPECIFIED]: "week",
  [RoadmapZoom.DAY]: "day",
  [RoadmapZoom.WEEK]: "week",
  [RoadmapZoom.MONTH]: "month",
};

const ROADMAP_ZOOMS: Record<ZoomLevel, RoadmapZoom> = {
  day: RoadmapZoom.DAY,
  week: RoadmapZoom.WEEK,
  month: RoadmapZoom.MONTH,
};

export function RoadmapView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  // Subtasks are real rows here; the "Top-level only" filter is the opt-in for
  // a flat root view.
  const filteredTasks = useFilteredTasks(project?.id ?? "", { includeSubtasks: true });
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const sprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));
  const searchQuery = useAppSelector(selectSearchQuery);
  const { canEdit } = useProjectPermission();

  const definition = useAppSelector(selectActiveDefinition(project?.id ?? ""));
  const zoom: ZoomLevel =
    definition.layout.type === "roadmap" ? ZOOM_LEVELS[definition.layout.zoom] : "week";

  // Collapsed parents; descendants drop out of the ordered rows entirely.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const { groups } = useTaskGroups(project?.id ?? "", filteredTasks, definition.groupBy);
  const collapsedGroups = useMemo(
    () => new Set(definition.collapsedGroupKeys),
    [definition.collapsedGroupKeys],
  );
  // Grouped rows keep the hierarchy inside each group; a parent in another group leaves its
  // children as roots there.
  const rows = useMemo<RoadmapRow[]>(
    () =>
      groups
        ? buildGroupedRows(groups, collapsedIds, collapsedGroups)
        : buildOrderedRows(filteredTasks, collapsedIds),
    [groups, filteredTasks, collapsedIds, collapsedGroups],
  );
  const toggleGroup = useCallback(
    (groupKey: string) => {
      if (project) dispatch(toggleDraftCollapsedGroup(project.id, groupKey));
    },
    [dispatch, project],
  );
  // Rollup spans are derived from the full task set, so a collapsed parent
  // still shows its aggregate bracket.
  const rollupSpans = useMemo(() => computeRollupSpans(filteredTasks), [filteredTasks]);
  const toggleCollapse = useCallback((taskId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Base date for timeline (center point)
  const [baseDate, setBaseDate] = useState(() => getStartOfPeriod(new Date(), "week"));

  // Scroll synchronization - initialize scrollLeft so today is visible
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(() => PERIODS_BEFORE * COLUMN_WIDTHS[zoom] - 200);

  // Ref to timeline scroll container for direct scroll control
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // Calculate timeline range
  const timelineStart = useMemo(
    () => addPeriods(baseDate, -PERIODS_BEFORE, zoom),
    [baseDate, zoom],
  );
  const timelineEnd = useMemo(() => addPeriods(baseDate, PERIODS_AFTER, zoom), [baseDate, zoom]);

  // Generate timeline columns
  const columns = useMemo(
    () => generateTimelineColumns(timelineStart, timelineEnd, zoom),
    [timelineStart, timelineEnd, zoom],
  );

  // Calculate dependency data for lines
  const dependencyData = useMemo(() => {
    return rows
      .map((row, index) => {
        if (row.kind !== "task") return null;
        const task = row.task;
        const hasOwnDates = !!(task.startDate && task.dueDate);
        const own = hasOwnDates
          ? calculateBarPosition(task.startDate, task.dueDate, timelineStart, timelineEnd, zoom)
          : null;
        const span = !hasOwnDates ? rollupSpans.get(task.id) : undefined;
        const position =
          own ??
          (span
            ? calculateBarPosition(span.start, span.due, timelineStart, timelineEnd, zoom)
            : null);

        return {
          id: task.id,
          blockedByTaskIds: task.blockedByTaskIds || [],
          row: index,
          left: position ? position.left : 0,
          width: position ? position.width : 0,
          hasDates: !!position,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null && t.hasDates);
  }, [rows, rollupSpans, timelineStart, timelineEnd, zoom]);

  // Handle task click
  const handleTaskClick = useCallback(
    (taskId: string, e?: React.MouseEvent) => {
      if (e && (e.ctrlKey || e.metaKey)) {
        dispatch(toggleTaskSelection(taskId));
      } else {
        dispatch(selectTask(taskId));
        dispatch(openDetailPanel());
      }
    },
    [dispatch],
  );

  // Handle checkbox toggle (no detail panel)
  const handleCheckboxChange = useCallback(
    (taskId: string) => {
      dispatch(toggleTaskSelection(taskId));
    },
    [dispatch],
  );

  // Handle navigation
  const handleToday = useCallback(() => {
    const today = getStartOfPeriod(new Date(), zoom);
    setBaseDate(today);
    setScrollLeft(PERIODS_BEFORE * COLUMN_WIDTHS[zoom] - 200);
  }, [zoom]);

  const handlePrevious = useCallback(() => {
    const steps = zoom === "day" ? -7 : zoom === "week" ? -4 : -3;
    setBaseDate((prev) => addPeriods(prev, steps, zoom));
  }, [zoom]);

  const handleNext = useCallback(() => {
    const steps = zoom === "day" ? 7 : zoom === "week" ? 4 : 3;
    setBaseDate((prev) => addPeriods(prev, steps, zoom));
  }, [zoom]);

  // Handle zoom change - also scroll to today
  const handleZoomChange = useCallback(
    (newZoom: ZoomLevel) => {
      if (project) {
        dispatch(setDraftLayout(project.id, { type: "roadmap", zoom: ROADMAP_ZOOMS[newZoom] }));
      }
      setBaseDate(getStartOfPeriod(new Date(), newZoom));
      setScrollLeft(PERIODS_BEFORE * COLUMN_WIDTHS[newZoom] - 200);
    },
    [dispatch, project],
  );

  // Handle task list wheel: directly scroll the timeline element (browser clamps)
  const handleTaskListWheel = useCallback((deltaY: number) => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop += deltaY;
    }
  }, []);

  // Handle add task
  const handleAddTask = useCallback(() => {
    dispatch(openCreateTaskModal());
  }, [dispatch]);

  // Handle bar resize (drag start/end edges)
  const handleBarResize = useCallback(
    (taskId: string, startDate: string, dueDate: string) => {
      dispatch(optimisticUpdateTask({ id: taskId, startDate, dueDate }));
      dispatch(updateTask({ id: taskId, startDate, dueDate }));
    },
    [dispatch],
  );

  // Early return after all hooks
  if (!project) {
    return null;
  }

  // Get status options
  const statusField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const statusOptions = statusField?.config.options || [];

  // Show empty state if no tasks
  if (filteredTasks.length === 0 && !searchQuery) {
    return <EmptyState onCreateTask={canEdit ? handleAddTask : undefined} />;
  }

  // Check for overdue tasks
  const today = startOfDay(new Date());
  const isTaskOverdue = (dueDate: string | null) => {
    if (!dueDate) return false;
    return new Date(dueDate) < today;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-border bg-card gap-2">
        {/* Navigation */}
        <div className="flex items-center gap-1 md:gap-2">
          <Button variant="outline" size="sm" onClick={handlePrevious}>
            <CaretLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday}>
            <CalendarBlank size={16} className="md:mr-1" />
            <span className="hidden md:inline">Today</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleNext}>
            <CaretRight size={16} />
          </Button>

          <span className="hidden md:inline text-sm text-muted-foreground ml-2">
            {format(timelineStart, "MMM d")} - {format(timelineEnd, "MMM d, yyyy")}
          </span>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <ZoomButton
            label="Day"
            isActive={zoom === "day"}
            onClick={() => handleZoomChange("day")}
          />
          <ZoomButton
            label="Week"
            isActive={zoom === "week"}
            onClick={() => handleZoomChange("week")}
          />
          <ZoomButton
            label="Month"
            isActive={zoom === "month"}
            onClick={() => handleZoomChange("month")}
          />
        </div>
      </div>

      {/* Main content: Task list + Timeline */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Task List */}
        <RoadmapTaskList
          rows={rows}
          statusOptions={statusOptions}
          selectedTaskIds={selectedTaskIds}
          projectSlug={project.slug}
          collapsedIds={collapsedIds}
          onTaskClick={handleTaskClick}
          onCheckboxChange={handleCheckboxChange}
          onToggleCollapse={toggleCollapse}
          onToggleGroup={toggleGroup}
          numberFields={project.fieldDefinitions.filter((field) => field.type === "number")}
          onWheel={handleTaskListWheel}
          scrollTop={scrollTop}
        />

        {/* Right: Timeline Grid (scroll master for both axes) */}
        <div className="flex-1 overflow-hidden">
          <TimelineGrid
            columns={columns}
            zoom={zoom}
            rowCount={rows.length}
            scrollLeft={scrollLeft}
            onScroll={setScrollLeft}
            onScrollTop={setScrollTop}
            scrollContainerRef={timelineScrollRef}
            sprints={sprints}
            timelineStart={timelineStart}
          >
            {/* Dependency Lines */}
            <DependencyLines tasks={dependencyData} />

            {/* Task rows */}
            <div
              style={{
                height: rows.length * LAYOUT.ROADMAP_ROW_HEIGHT,
                position: "relative",
                zIndex: 10, // Ensure bars are above lines
              }}
            >
              {rows.map((row, index) => {
                if (row.kind === "group") {
                  return <GroupGanttRow key={row.key} rowIndex={index} />;
                }
                const task = row.task;
                const hasOwnDates = !!(task.startDate && task.dueDate);
                const position = hasOwnDates
                  ? calculateBarPosition(
                      task.startDate,
                      task.dueDate,
                      timelineStart,
                      timelineEnd,
                      zoom,
                    )
                  : null;

                if (position) {
                  return (
                    <GanttBar
                      key={row.key}
                      task={task}
                      position={position}
                      paint={statusPaint(statusOptions, task.status)}
                      isSelected={selectedTaskIds.includes(task.id)}
                      isOverdue={isTaskOverdue(task.dueDate)}
                      onClick={(e: React.MouseEvent) => handleTaskClick(task.id, e)}
                      rowIndex={index}
                      viewStartDate={timelineStart}
                      zoom={zoom}
                      onResizeEnd={handleBarResize}
                    />
                  );
                }

                // Parent without its own dates: show a rollup bracket spanning subtasks.
                if (!hasOwnDates) {
                  const span = rollupSpans.get(task.id);
                  const rollupPosition = span
                    ? calculateBarPosition(span.start, span.due, timelineStart, timelineEnd, zoom)
                    : null;
                  if (rollupPosition) {
                    return (
                      <SummaryBar
                        key={row.key}
                        position={rollupPosition}
                        rowIndex={index}
                        onClick={(e: React.MouseEvent) => handleTaskClick(task.id, e)}
                      />
                    );
                  }
                }

                return <EmptyGanttRow key={row.key} rowIndex={index} />;
              })}
            </div>
          </TimelineGrid>
        </div>
      </div>

      {/* Legend - hidden on mobile */}
      <div className="hidden md:flex items-center gap-4 px-4 py-2 border-t border-border bg-card text-xs text-muted-foreground">
        <span className="font-medium">Legend:</span>
        {statusOptions.map((status) => (
          <div key={status.id} className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded"
              style={{ background: statusPaint(statusOptions, status.id).gradient }}
            />
            <span>{status.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-4">
          <div className="w-3 h-3 rounded border-2 border-dashed border-destructive" />
          <span>Overdue</span>
        </div>
        {rollupSpans.size > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-4 h-1.5 rounded-full bg-muted-foreground/70" />
            <span>Rolled up</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface ZoomButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function ZoomButton({ label, isActive, onClick }: ZoomButtonProps) {
  return (
    <button
      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
