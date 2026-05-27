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
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
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
import { TimelineGrid } from "./TimelineGrid";
import { GanttBar, EmptyGanttRow } from "./GanttBar";
import { DependencyLines } from "./DependencyLines";
import { EmptyState } from "../table/EmptyState";

// Number of periods to show in each direction from center
const PERIODS_BEFORE = 15;
const PERIODS_AFTER = 45;

export function RoadmapView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const filteredTasks = useFilteredTasks(project?.id ?? "");
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const sprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));
  const searchQuery = useAppSelector(selectSearchQuery);

  // Zoom level state
  const [zoom, setZoom] = useState<ZoomLevel>("week");

  // Base date for timeline (center point)
  const [baseDate, setBaseDate] = useState(() => getStartOfPeriod(new Date(), "week"));

  // Scroll synchronization - initialize scrollLeft so today is visible
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(
    () => PERIODS_BEFORE * COLUMN_WIDTHS[zoom] - 200
  );

  // Ref to timeline scroll container for direct scroll control
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // Calculate timeline range
  const timelineStart = useMemo(
    () => addPeriods(baseDate, -PERIODS_BEFORE, zoom),
    [baseDate, zoom]
  );
  const timelineEnd = useMemo(
    () => addPeriods(baseDate, PERIODS_AFTER, zoom),
    [baseDate, zoom]
  );

  // Generate timeline columns
  const columns = useMemo(
    () => generateTimelineColumns(timelineStart, timelineEnd, zoom),
    [timelineStart, timelineEnd, zoom]
  );

  // Calculate dependency data for lines
  const dependencyData = useMemo(() => {
    return filteredTasks.map((task, index) => {
      const position = calculateBarPosition(
        task.startDate,
        task.dueDate,
        timelineStart,
        timelineEnd,
        zoom
      );
      
      return {
        id: task.id,
        blockedByTaskIds: task.blockedByTaskIds || [],
        row: index,
        left: position ? position.left : 0,
        width: position ? position.width : 0,
        hasDates: !!position,
      };
    }).filter(t => t.hasDates);
  }, [filteredTasks, timelineStart, timelineEnd, zoom]);

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
    [dispatch]
  );

  // Handle checkbox toggle (no detail panel)
  const handleCheckboxChange = useCallback(
    (taskId: string) => {
      dispatch(toggleTaskSelection(taskId));
    },
    [dispatch]
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
  const handleZoomChange = useCallback((newZoom: ZoomLevel) => {
    setZoom(newZoom);
    setBaseDate(getStartOfPeriod(new Date(), newZoom));
    setScrollLeft(PERIODS_BEFORE * COLUMN_WIDTHS[newZoom] - 200);
  }, []);

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
    [dispatch]
  );

  // Early return after all hooks
  if (!project) {
    return null;
  }

  // Get status options
  const statusField = project.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS
  );
  const statusOptions = statusField?.config.options || [];

  // Show empty state if no tasks
  if (filteredTasks.length === 0 && !searchQuery) {
    return <EmptyState onCreateTask={handleAddTask} />;
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
          tasks={filteredTasks}
          statusOptions={statusOptions}
          selectedTaskIds={selectedTaskIds}
          projectSlug={project.slug}
          onTaskClick={handleTaskClick}
          onCheckboxChange={handleCheckboxChange}
          onWheel={handleTaskListWheel}
          scrollTop={scrollTop}
        />

        {/* Right: Timeline Grid (scroll master for both axes) */}
        <div className="flex-1 overflow-hidden">
          <TimelineGrid
            columns={columns}
            zoom={zoom}
            rowCount={filteredTasks.length}
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
                  height: filteredTasks.length * LAYOUT.ROADMAP_ROW_HEIGHT,
                  position: "relative",
                  zIndex: 10, // Ensure bars are above lines
                }}
              >
                {filteredTasks.map((task, index) => {
                const position = calculateBarPosition(
                  task.startDate,
                  task.dueDate,
                  timelineStart,
                  timelineEnd,
                  zoom
                );

                const statusOption = statusOptions.find(
                  (s) => s.id === task.status
                );

                if (!position) {
                  return <EmptyGanttRow key={task.id} rowIndex={index} />;
                }

                return (
                  <GanttBar
                    key={task.id}
                    task={task}
                    position={position}
                    statusOption={statusOption}
                    isSelected={selectedTaskIds.includes(task.id)}
                    isOverdue={isTaskOverdue(task.dueDate)}
                    onClick={(e: React.MouseEvent) => handleTaskClick(task.id, e)}
                    rowIndex={index}
                    viewStartDate={timelineStart}
                    zoom={zoom}
                    onResizeEnd={handleBarResize}
                  />
                );
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
              style={{ backgroundColor: status.color }}
            />
            <span>{status.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-4">
          <div className="w-3 h-3 rounded border-2 border-dashed border-destructive" />
          <span>Overdue</span>
        </div>
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
