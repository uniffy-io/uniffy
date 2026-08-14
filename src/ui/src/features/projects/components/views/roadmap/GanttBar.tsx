import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import type { SerializedMemberInfo } from "@/features/admin";
import { LAYOUT } from "../../../constants";
import type { Task, SelectOption } from "../../../types";
import type { GanttBarPosition } from "../../../utils/ganttPositioning";
import { pixelToDate } from "../../../utils/ganttPositioning";
import type { ZoomLevel } from "../../../utils/ganttPositioning";

const HANDLE_WIDTH = 8;
const MIN_BAR_WIDTH = 20;

interface GanttBarProps {
  task: Task;
  position: GanttBarPosition;
  statusOption?: SelectOption;
  isSelected: boolean;
  isOverdue: boolean;
  onClick: (e: React.MouseEvent) => void;
  rowIndex: number;
  viewStartDate: Date;
  zoom: ZoomLevel;
  onResizeEnd?: (taskId: string, startDate: string, dueDate: string) => void;
}

export function GanttBar({
  task,
  position,
  statusOption,
  isSelected,
  isOverdue,
  onClick,
  rowIndex,
  viewStartDate,
  zoom,
  onResizeEnd,
}: GanttBarProps) {
  const barColor = statusOption?.color || "#6b7280";
  const top =
    rowIndex * LAYOUT.ROADMAP_ROW_HEIGHT +
    (LAYOUT.ROADMAP_ROW_HEIGHT - LAYOUT.GANTT_BAR_HEIGHT) / 2;

  // Resolve assignee IDs to display names
  const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
  const memberMap = useMemo(() => {
    const map: Record<string, SerializedMemberInfo> = {};
    for (const m of members) {
      map[m.userId] = m;
    }
    return map;
  }, [members]);

  // Drag state - use refs for event handlers to avoid stale closures,
  // state for rendering only
  const dragRef = useRef<{
    edge: "start" | "end" | "move";
    initialMouseX: number;
    initialLeft: number;
    initialWidth: number;
  } | null>(null);
  const dragDeltaRef = useRef<{ left: number; width: number } | null>(null);
  const [dragDelta, setDragDelta] = useState<{ left: number; width: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragEdge, setDragEdge] = useState<"start" | "end" | "move" | null>(null);
  const didDragRef = useRef(false);

  // Keep stable refs for values needed in event handlers
  const propsRef = useRef({
    viewStartDate,
    zoom,
    taskId: task.id,
    startDate: task.startDate,
    dueDate: task.dueDate,
    onResizeEnd,
    positionLeft: position.left,
    positionWidth: position.width,
  });
  useEffect(() => {
    propsRef.current = {
      viewStartDate,
      zoom,
      taskId: task.id,
      startDate: task.startDate,
      dueDate: task.dueDate,
      onResizeEnd,
      positionLeft: position.left,
      positionWidth: position.width,
    };
  });

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { edge, initialMouseX, initialLeft, initialWidth } = dragRef.current;
      const { positionLeft, positionWidth } = propsRef.current;
      const dx = e.clientX - initialMouseX;

      let delta: { left: number; width: number };
      if (edge === "move") {
        const newLeft = initialLeft + dx;
        delta = { left: newLeft - positionLeft, width: 0 };
      } else if (edge === "start") {
        const newLeft = initialLeft + dx;
        const newWidth = initialWidth - dx;
        if (newWidth < MIN_BAR_WIDTH) return;
        delta = { left: newLeft - positionLeft, width: newWidth - positionWidth };
      } else {
        const newWidth = initialWidth + dx;
        if (newWidth < MIN_BAR_WIDTH) return;
        delta = { left: 0, width: newWidth - positionWidth };
      }

      dragDeltaRef.current = delta;
      setDragDelta(delta);
      didDragRef.current = true;
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      const { edge } = dragRef.current;
      const {
        positionLeft,
        positionWidth,
        viewStartDate: vsd,
        zoom: z,
        taskId,
        startDate: sd,
        dueDate: dd,
        onResizeEnd: handler,
      } = propsRef.current;
      const delta = dragDeltaRef.current;

      if (didDragRef.current && handler) {
        const currentLeft = positionLeft + (delta?.left ?? 0);
        const currentWidth = positionWidth + (delta?.width ?? 0);

        if (edge === "move") {
          const newStartDate = pixelToDate(currentLeft, vsd, z);
          const newEndDate = pixelToDate(currentLeft + currentWidth, vsd, z);
          const adjustedEnd = new Date(newEndDate);
          adjustedEnd.setDate(adjustedEnd.getDate() - 1);
          handler(taskId, format(newStartDate, "yyyy-MM-dd"), format(adjustedEnd, "yyyy-MM-dd"));
        } else if (edge === "start") {
          const newStartDate = pixelToDate(currentLeft, vsd, z);
          handler(taskId, format(newStartDate, "yyyy-MM-dd"), dd!);
        } else {
          const newEndDate = pixelToDate(currentLeft + currentWidth, vsd, z);
          const adjustedEnd = new Date(newEndDate);
          adjustedEnd.setDate(adjustedEnd.getDate() - 1);
          handler(taskId, sd!, format(adjustedEnd, "yyyy-MM-dd"));
        }
      }

      dragRef.current = null;
      dragDeltaRef.current = null;
      setDragDelta(null);
      setDragEdge(null);
      setIsDragging(false);

      requestAnimationFrame(() => {
        didDragRef.current = false;
      });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  const handleEdgeMouseDown = useCallback(
    (edge: "start" | "end", e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      didDragRef.current = false;
      dragRef.current = {
        edge,
        initialMouseX: e.clientX,
        initialLeft: position.left,
        initialWidth: position.width,
      };
      setDragEdge(edge);
      setIsDragging(true);
    },
    [position.left, position.width],
  );

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      didDragRef.current = false;
      dragRef.current = {
        edge: "move",
        initialMouseX: e.clientX,
        initialLeft: position.left,
        initialWidth: position.width,
      };
      setDragEdge("move");
      setIsDragging(true);
    },
    [position.left, position.width],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (didDragRef.current) return;
      onClick(e);
    },
    [onClick],
  );

  // Apply drag delta to position
  const displayLeft = position.left + (dragDelta?.left ?? 0);
  const displayWidth = position.width + (dragDelta?.width ?? 0);

  return (
    <div
      className={cn(
        "absolute flex items-center gap-1 px-2 rounded group",
        "hover:ring-2 hover:ring-offset-1 hover:ring-offset-background",
        !isDragging && "transition-all",
        isDragging && dragEdge === "move" ? "cursor-grabbing" : "cursor-grab",
        isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        isOverdue && !isSelected && "ring-2 ring-destructive ring-dashed",
      )}
      style={{
        left: displayLeft,
        width: displayWidth,
        top,
        height: LAYOUT.GANTT_BAR_HEIGHT,
        backgroundColor: barColor,
        borderTopLeftRadius: position.isPartialStart ? 0 : 4,
        borderBottomLeftRadius: position.isPartialStart ? 0 : 4,
        borderTopRightRadius: position.isPartialEnd ? 0 : 4,
        borderBottomRightRadius: position.isPartialEnd ? 0 : 4,
        userSelect: isDragging ? "none" : undefined,
      }}
      onMouseDown={handleBarMouseDown}
      onClick={handleClick}
    >
      {/* Left resize handle */}
      {!position.isPartialStart && (
        <div
          className="absolute left-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center justify-center"
          style={{ width: HANDLE_WIDTH }}
          onMouseDown={(e) => handleEdgeMouseDown("start", e)}
        >
          <div className="w-0.5 h-3 rounded-full bg-white/0 group-hover:bg-white/50 transition-colors" />
        </div>
      )}

      {/* Milestone indicator */}
      {task.isMilestone && (
        <div
          className="w-2.5 h-2.5 shrink-0 rotate-45 border border-white/60"
          style={{ backgroundColor: "white", opacity: 0.85 }}
        />
      )}

      {/* Task title */}
      <span
        className="text-xs font-medium text-white truncate flex-1"
        style={{ marginLeft: task.isMilestone ? 0 : HANDLE_WIDTH - 8 }}
      >
        {task.title}
      </span>

      {/* Assignee avatar */}
      {task.assigneeIds.length > 0 &&
        displayWidth > 80 &&
        (() => {
          const member = memberMap[task.assigneeIds[0]];
          const name = member?.displayName;
          let initials: string;
          if (!name) {
            initials = task.assigneeIds[0].slice(-2).toUpperCase();
          } else {
            const parts = name.split(" ").filter(Boolean);
            initials =
              parts.length >= 2
                ? (parts[0][0] + parts[1][0]).toUpperCase()
                : name.slice(0, 2).toUpperCase();
          }
          return (
            <div
              className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[9px] text-white shrink-0"
              title={name}
            >
              {initials}
            </div>
          );
        })()}

      {/* Right resize handle */}
      {!position.isPartialEnd && (
        <div
          className="absolute right-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center justify-center"
          style={{ width: HANDLE_WIDTH }}
          onMouseDown={(e) => handleEdgeMouseDown("end", e)}
        >
          <div className="w-0.5 h-3 rounded-full bg-white/0 group-hover:bg-white/50 transition-colors" />
        </div>
      )}
    </div>
  );
}

interface EmptyGanttRowProps {
  rowIndex: number;
}

export function EmptyGanttRow({ rowIndex }: EmptyGanttRowProps) {
  const top = rowIndex * LAYOUT.ROADMAP_ROW_HEIGHT;

  return (
    <div
      className="absolute inset-x-0 border-b border-border"
      style={{
        top,
        height: LAYOUT.ROADMAP_ROW_HEIGHT,
      }}
    />
  );
}

interface SummaryBarProps {
  position: GanttBarPosition;
  rowIndex: number;
  onClick: (e: React.MouseEvent) => void;
}

/** Read-only rollup bracket for a parent with no dates of its own; spans the
 *  date range of its descendants. Distinct from a draggable task bar. */
export function SummaryBar({ position, rowIndex, onClick }: SummaryBarProps) {
  const top = rowIndex * LAYOUT.ROADMAP_ROW_HEIGHT + LAYOUT.ROADMAP_ROW_HEIGHT / 2;

  return (
    <div
      className="absolute -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground cursor-pointer"
      style={{ left: position.left, width: position.width, top, height: 14 }}
      onClick={onClick}
      title="Rolled up from subtasks"
    >
      <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-current" />
      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-sm bg-current" />
      <span className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-sm bg-current" />
    </div>
  );
}
