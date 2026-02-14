/**
 * RoadmapTaskList - Left panel showing task rows
 *
 * Features:
 * - Status icon, title
 * - Assignee avatar
 * - "No dates" indicator for unscheduled tasks
 * - Synchronized vertical scroll with timeline (mirrors via transform)
 */

import { useRef, useEffect } from "react";
import { Circle, CheckCircle, Spinner } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { LAYOUT } from "@/features/projects/constants";
import type { Task, SelectOption } from "@/features/projects/types";

interface RoadmapTaskListProps {
  tasks: Task[];
  statusOptions: SelectOption[];
  selectedTaskIds: string[];
  onTaskClick: (taskId: string, e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  onWheel: (deltaY: number) => void;
  scrollTop: number;
}

export function RoadmapTaskList({
  tasks,
  statusOptions,
  selectedTaskIds,
  onTaskClick,
  onCheckboxChange,
  onWheel,
  scrollTop,
}: RoadmapTaskListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Non-passive wheel listener to prevent page scroll and forward delta
  const onWheelRef = useRef(onWheel);

  useEffect(() => {
    onWheelRef.current = onWheel;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheelRef.current(e.deltaY);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ width: LAYOUT.ROADMAP_TASK_LIST_WIDTH }}
    >
      {/* Header */}
      <div
        className="flex items-center px-3 border-b border-r border-border bg-muted/50 font-medium text-sm text-muted-foreground"
        style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT }}
      >
        Tasks
      </div>

      {/* Task List - no independent scroll, mirrors timeline via transform */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden border-r border-border"
      >
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {tasks.map((task) => {
            const statusOption = statusOptions.find((s) => s.id === task.status);
            const hasDates = task.startDate && task.dueDate;

            return (
              <RoadmapTaskRow
                key={task.id}
                task={task}
                statusOption={statusOption}
                hasDates={!!hasDates}
                isSelected={selectedTaskIds.includes(task.id)}
                onClick={(e) => onTaskClick(task.id, e)}
                onCheckboxChange={() => onCheckboxChange(task.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface RoadmapTaskRowProps {
  task: Task;
  statusOption?: SelectOption;
  hasDates: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: () => void;
}

function RoadmapTaskRow({
  task,
  statusOption,
  hasDates,
  isSelected,
  onClick,
  onCheckboxChange,
}: RoadmapTaskRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 border-b border-border cursor-pointer",
        "hover:bg-muted/30 transition-colors",
        isSelected && "bg-primary/5",
        !hasDates && "opacity-50"
      )}
      style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT }}
      onClick={onClick}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute left-0 w-0.5 h-full bg-primary" />
      )}

      {/* Checkbox */}
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-border shrink-0"
        checked={isSelected}
        onChange={(e) => {
          e.stopPropagation();
          onCheckboxChange();
        }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Status icon */}
      <StatusIcon
        statusId={statusOption?.id}
        color={statusOption?.color || "#6b7280"}
      />

      {/* Task title */}
      <span
        className={cn(
          "flex-1 text-sm truncate",
          hasDates ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {task.title}
      </span>

      {/* No dates indicator */}
      {!hasDates && (
        <span className="text-xs text-muted-foreground italic">No dates</span>
      )}

      {/* Assignee avatar */}
      {task.assigneeIds.length > 0 && (
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] text-primary-foreground shrink-0">
          {task.assigneeIds[0].slice(-2).toUpperCase()}
        </div>
      )}
    </div>
  );
}

interface StatusIconProps {
  statusId?: string;
  color: string;
}

function StatusIcon({ statusId, color }: StatusIconProps) {
  const iconProps = {
    size: 16,
    weight: "fill" as const,
    className: "shrink-0",
    style: { color },
  };

  if (!statusId) {
    return <Circle {...iconProps} />;
  }

  if (statusId.includes("done") || statusId.includes("complete")) {
    return <CheckCircle {...iconProps} />;
  }
  if (statusId.includes("progress")) {
    return <Spinner {...iconProps} />;
  }
  return <Circle {...iconProps} />;
}
