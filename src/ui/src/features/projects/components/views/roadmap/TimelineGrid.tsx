import { useRef, useEffect, useMemo } from "react";
import { parseISO } from "date-fns";
import { cn } from "@/shared/utils/cn";
import { LAYOUT } from "../../../constants";
import type { ZoomLevel, TimelineColumn } from "../../../utils/ganttPositioning";
import { COLUMN_WIDTHS, dateToPixelX } from "../../../utils/ganttPositioning";
import type { Sprint } from "../../../types";

interface TimelineGridProps {
  columns: TimelineColumn[];
  zoom: ZoomLevel;
  rowCount: number;
  scrollLeft: number;
  onScroll: (scrollLeft: number) => void;
  onScrollTop: (scrollTop: number) => void;
  /** External ref for the scroll container - allows parent to directly scroll */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  /** Sprints to render as boundary lines on the timeline */
  sprints?: Sprint[];
  /** Start date of the timeline view (needed for sprint line positioning) */
  timelineStart?: Date;
}

export function TimelineGrid({
  columns,
  zoom,
  rowCount,
  scrollLeft,
  onScroll,
  onScrollTop,
  scrollContainerRef,
  children,
  sprints,
  timelineStart,
}: TimelineGridProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef ?? internalRef;
  const columnWidth = COLUMN_WIDTHS[zoom];
  const totalWidth = columns.length * columnWidth;

  // Handle scroll events (both horizontal and vertical)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    onScroll(e.currentTarget.scrollLeft);
    onScrollTop(e.currentTarget.scrollTop);
  };

  // Sync horizontal scroll position from parent
  useEffect(() => {
    if (scrollRef.current && Math.abs(scrollRef.current.scrollLeft - scrollLeft) > 1) {
      scrollRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollLeft, scrollRef]);

  // Group columns for top header row: by year for month zoom, by month otherwise
  const topGroups =
    zoom === "month"
      ? groupColumnsByYear(columns, columnWidth)
      : groupColumnsByMonth(columns, columnWidth);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with month and day labels */}
      <div className="shrink-0 bg-muted/50">
        {/* Month row */}
        <div
          className="flex border-b border-border"
          style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT / 2 }}
        >
          <div
            className="flex"
            style={{
              width: totalWidth,
              transform: `translateX(-${scrollLeft}px)`,
            }}
          >
            {topGroups.map((group) => (
              <div
                key={group.key}
                className="flex items-center justify-center text-xs font-medium text-muted-foreground border-r border-border"
                style={{ width: group.width }}
              >
                {group.label}
              </div>
            ))}
          </div>
        </div>

        {/* Day/Week row */}
        <div
          className="flex border-b border-border"
          style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT / 2 }}
        >
          <div
            className="flex"
            style={{
              width: totalWidth,
              transform: `translateX(-${scrollLeft}px)`,
            }}
          >
            {columns.map((column, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center justify-center text-xs border-r border-border",
                  column.isToday && "bg-primary/10 font-semibold text-primary",
                  zoom === "day" && column.isWeekend && !column.isToday && "bg-muted/30",
                )}
                style={{ width: columnWidth }}
              >
                {column.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Grid body with task bars */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div className="relative" style={{ width: totalWidth }}>
          {/* Vertical grid lines */}
          <div className="absolute inset-0 flex pointer-events-none">
            {columns.map((column, index) => (
              <div
                key={index}
                className={cn(
                  "border-r border-border h-full",
                  zoom === "day" && column.isWeekend && "bg-muted/20",
                )}
                style={{ width: columnWidth }}
              />
            ))}
          </div>

          {/* Horizontal row lines */}
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: rowCount }).map((_, index) => (
              <div
                key={index}
                className="absolute inset-x-0 h-px bg-border"
                style={{ top: (index + 1) * LAYOUT.ROADMAP_ROW_HEIGHT - 1 }}
              />
            ))}
          </div>

          {/* Today marker */}
          <TodayMarker columns={columns} columnWidth={columnWidth} />

          {/* Sprint boundary lines */}
          {sprints && timelineStart && sprints.length > 0 && (
            <SprintBoundaryLines sprints={sprints} timelineStart={timelineStart} zoom={zoom} />
          )}

          {/* Task bars (children) */}
          <div className="relative">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface TodayMarkerProps {
  columns: TimelineColumn[];
  columnWidth: number;
}

function TodayMarker({ columns, columnWidth }: TodayMarkerProps) {
  const todayIndex = columns.findIndex((c) => c.isToday);
  if (todayIndex === -1) return null;

  const left = todayIndex * columnWidth + columnWidth / 2;

  return (
    <div
      className="absolute top-0 bottom-0 w-0.5 bg-destructive z-10 pointer-events-none"
      style={{ left }}
    >
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-destructive" />
    </div>
  );
}

interface HeaderGroup {
  key: string;
  label: string;
  width: number;
}

function groupColumnsByMonth(columns: TimelineColumn[], colWidth: number): HeaderGroup[] {
  const groups: HeaderGroup[] = [];
  let currentGroup: HeaderGroup | null = null;

  columns.forEach((column) => {
    const monthKey = `${column.date.getFullYear()}-${column.date.getMonth()}`;

    if (column.isFirstOfMonth || !currentGroup) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        key: monthKey,
        label: column.monthLabel || "",
        width: colWidth,
      };
    } else {
      currentGroup.width += colWidth;
    }
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

interface SprintBoundaryLinesProps {
  sprints: Sprint[];
  timelineStart: Date;
  zoom: ZoomLevel;
}

function SprintBoundaryLines({ sprints, timelineStart, zoom }: SprintBoundaryLinesProps) {
  const lines = useMemo(() => {
    const result: {
      key: string;
      left: number;
      label: string;
      isStart: boolean;
      isActive: boolean;
    }[] = [];

    for (const sprint of sprints) {
      if (sprint.status === "closed") continue;

      const isActive = sprint.status === "active";

      if (sprint.startDate) {
        const startDate = parseISO(sprint.startDate);
        result.push({
          key: `${sprint.id}-start`,
          left: dateToPixelX(startDate, timelineStart, zoom),
          label: sprint.name,
          isStart: true,
          isActive,
        });
      }

      if (sprint.endDate) {
        const endDate = parseISO(sprint.endDate);
        // +1 day so the line sits at the end of the last day
        const dayAfterEnd = new Date(endDate);
        dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
        result.push({
          key: `${sprint.id}-end`,
          left: dateToPixelX(dayAfterEnd, timelineStart, zoom),
          label: sprint.name,
          isStart: false,
          isActive,
        });
      }
    }

    return result;
  }, [sprints, timelineStart, zoom]);

  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line) => (
        <div
          key={line.key}
          className="absolute top-0 bottom-0 z-20 pointer-events-none"
          style={{ left: line.left }}
        >
          {/* Dashed line - calendar-style repeating gradient */}
          <div
            className={cn(
              "absolute inset-0 w-0.5",
              line.isActive ? "bg-primary/80" : "bg-muted-foreground/50",
            )}
            style={{
              backgroundImage: `repeating-linear-gradient(
                to bottom,
                currentColor 0px,
                currentColor 4px,
                transparent 4px,
                transparent 8px
              )`,
              backgroundColor: "transparent",
              color: line.isActive
                ? "hsl(var(--primary) / 0.8)"
                : "hsl(var(--muted-foreground) / 0.5)",
            }}
          />
          {/* Vertical label running along the line */}
          <div
            className={cn(
              "absolute top-3 text-[10px] font-medium whitespace-nowrap leading-none",
              line.isActive ? "text-primary/80" : "text-muted-foreground/50",
            )}
            style={{
              writingMode: "vertical-lr",
              ...(line.isStart ? { right: 4 } : { left: 4 }),
            }}
          >
            {line.label} {line.isStart ? "start" : "end"}
          </div>
        </div>
      ))}
    </>
  );
}

function groupColumnsByYear(columns: TimelineColumn[], colWidth: number): HeaderGroup[] {
  const groups: HeaderGroup[] = [];
  let currentGroup: HeaderGroup | null = null;

  columns.forEach((column) => {
    const yearKey = String(column.date.getFullYear());

    if (column.isFirstOfYear || !currentGroup) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        key: yearKey,
        label: column.yearLabel || yearKey,
        width: colWidth,
      };
    } else {
      currentGroup.width += colWidth;
    }
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}
