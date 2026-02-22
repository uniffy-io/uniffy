/**
 * RoadmapTaskList - Left panel showing task rows
 *
 * Features:
 * - Status icon, title
 * - Assignee avatar
 * - "No dates" indicator for unscheduled tasks
 * - Synchronized vertical scroll with timeline (mirrors via transform)
 */

import { useRef, useEffect, useMemo } from "react";
import { Circle, CheckCircle, Spinner } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { LAYOUT } from "@/features/projects/constants";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import type { Task, SelectOption } from "@/features/projects/types";
import type { SerializedMemberInfo } from "@/features/admin";

interface RoadmapTaskListProps {
  tasks: Task[];
  statusOptions: SelectOption[];
  selectedTaskIds: string[];
  projectSlug: string;
  onTaskClick: (taskId: string, e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  onWheel: (deltaY: number) => void;
  scrollTop: number;
}

export function RoadmapTaskList({
  tasks,
  statusOptions,
  selectedTaskIds,
  projectSlug,
  onTaskClick,
  onCheckboxChange,
  onWheel,
  scrollTop,
}: RoadmapTaskListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adminMembers = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];

  const memberMap = useMemo(() => {
    const map: Record<string, SerializedMemberInfo> = {};
    for (const m of adminMembers) {
      map[m.userId] = m;
    }
    return map;
  }, [adminMembers]);

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
                projectSlug={projectSlug}
                memberMap={memberMap}
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
  projectSlug: string;
  memberMap: Record<string, SerializedMemberInfo>;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: () => void;
}

function getInitials(member: SerializedMemberInfo): string {
  const parts = member.displayName.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return member.displayName.slice(0, 2).toUpperCase();
}

function RoadmapTaskRow({
  task,
  statusOption,
  hasDates,
  isSelected,
  projectSlug,
  memberMap,
  onClick,
  onCheckboxChange,
}: RoadmapTaskRowProps) {
  const typeConfig = getTaskTypeConfig(task.taskType || "task");
  const TypeIcon = typeConfig.icon;

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

      {/* Task type icon */}
      <TypeIcon
        size={14}
        weight="fill"
        className="text-muted-foreground shrink-0"
        title={typeConfig.label}
      />

      {/* Task ID */}
      <span className="text-xs font-mono text-muted-foreground shrink-0">
        {projectSlug}-{task.number}
      </span>

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

      {/* Assignee avatars */}
      {task.assigneeIds.length > 0 && (
        <div className="flex -space-x-1.5 shrink-0">
          {task.assigneeIds.slice(0, 2).map((id) => {
            const member = memberMap[id];
            const initials = member ? getInitials(member) : id.slice(-2).toUpperCase();
            return (
              <div
                key={id}
                className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[9px] font-medium text-primary-foreground border border-card"
                title={member?.displayName}
              >
                {initials}
              </div>
            );
          })}
          {task.assigneeIds.length > 2 && (
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground border border-card">
              +{task.assigneeIds.length - 2}
            </div>
          )}
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
