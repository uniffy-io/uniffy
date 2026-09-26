import { useRef, useEffect } from "react";
import { Circle, CheckCircle, Spinner, CaretRight, CaretDown } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { SubjectAvatarStack } from "@/components/subject";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { LAYOUT } from "@/features/projects/constants";
import { statusPaint, type StatusPaint } from "@/features/projects/utils/statusPaint";
import { statusSemanticOf } from "@/features/projects/utils/statusSemantics";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { TaskParentChip } from "@/features/projects/components/TaskParentChip";
import { BlockedBadge } from "@/features/projects/components/BlockedBadge";
import type {
  FieldDefinition,
  Task,
  SelectOption,
  TaskStatusSemantic,
} from "@/features/projects/types";
import { groupSums, type GroupSum, type TaskGroup } from "@/features/projects/utils/groupTasks";
import {
  GroupHeaderLabel,
  GroupHeaderStats,
} from "@/features/projects/components/views/GroupHeaderLabel";
import type { RoadmapRow } from "./roadmapRows";

interface RoadmapTaskListProps {
  rows: RoadmapRow[];
  statusOptions: SelectOption[];
  selectedTaskIds: string[];
  projectSlug: string;
  collapsedIds: Set<string>;
  onTaskClick: (taskId: string, e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleGroup: (groupKey: string) => void;
  /** Number fields a group header sums beside estimate and time spent. */
  numberFields: FieldDefinition[];
  onWheel: (deltaY: number) => void;
  scrollTop: number;
}

export function RoadmapTaskList({
  rows,
  statusOptions,
  selectedTaskIds,
  projectSlug,
  collapsedIds,
  onTaskClick,
  onCheckboxChange,
  onToggleCollapse,
  onToggleGroup,
  numberFields,
  onWheel,
  scrollTop,
}: RoadmapTaskListProps) {
  const { isMobile } = useBreakpoint();
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
      style={{ width: isMobile ? 200 : LAYOUT.ROADMAP_TASK_LIST_WIDTH }}
    >
      {/* Header */}
      <div
        className="flex items-center px-3 border-b border-r border-border bg-muted/50 font-medium text-sm text-muted-foreground"
        style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT }}
      >
        Tasks
      </div>

      {/* Task List - no independent scroll, mirrors timeline via transform */}
      <div ref={containerRef} className="flex-1 overflow-hidden border-r border-border">
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {rows.map((row) => {
            if (row.kind === "group") {
              return (
                <RoadmapGroupHeader
                  key={row.key}
                  group={row.group}
                  collapsed={row.collapsed}
                  sums={groupSums(row.group.tasks, numberFields)}
                  onToggle={() => onToggleGroup(row.group.key)}
                />
              );
            }
            const { task, depth, hasChildren } = row;
            const statusOption = statusOptions.find((s) => s.id === task.status);
            const hasDates = task.startDate && task.dueDate;

            return (
              <RoadmapTaskRow
                key={row.key}
                task={task}
                statusOption={statusOption}
                paint={statusPaint(statusOptions, task.status)}
                hasDates={!!hasDates}
                isSelected={selectedTaskIds.includes(task.id)}
                projectSlug={projectSlug}
                depth={depth}
                hasChildren={hasChildren}
                isCollapsed={collapsedIds.has(task.id)}
                onClick={(e) => onTaskClick(task.id, e)}
                onCheckboxChange={() => onCheckboxChange(task.id)}
                onToggleCollapse={() => onToggleCollapse(task.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RoadmapGroupHeader({
  group,
  collapsed,
  sums,
  onToggle,
}: {
  group: TaskGroup;
  collapsed: boolean;
  sums: GroupSum[];
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-2 px-3 border-b border-border bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT }}
    >
      {collapsed ? (
        <CaretRight size={12} weight="bold" className="text-muted-foreground shrink-0" />
      ) : (
        <CaretDown size={12} weight="bold" className="text-muted-foreground shrink-0" />
      )}
      <GroupHeaderLabel group={group} className="shrink min-w-0" />
      <GroupHeaderStats count={group.tasks.length} sums={sums} className="ml-auto justify-end" />
    </button>
  );
}

interface RoadmapTaskRowProps {
  task: Task;
  statusOption?: SelectOption;
  paint: StatusPaint;
  hasDates: boolean;
  isSelected: boolean;
  projectSlug: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: () => void;
  onToggleCollapse: () => void;
}

function RoadmapTaskRow({
  task,
  statusOption,
  paint,
  hasDates,
  isSelected,
  projectSlug,
  depth,
  hasChildren,
  isCollapsed,
  onClick,
  onCheckboxChange,
  onToggleCollapse,
}: RoadmapTaskRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 border-b border-border cursor-pointer",
        "hover:bg-muted/30 transition-colors",
        isSelected && "bg-primary/5",
        !hasDates && "opacity-50",
      )}
      style={{ height: LAYOUT.ROADMAP_ROW_HEIGHT }}
      onClick={onClick}
    >
      {/* Selection indicator */}
      {isSelected && <div className="absolute left-0 w-0.5 h-full bg-primary" />}

      {/* Indent + expand/collapse toggle */}
      <div className="flex items-center shrink-0" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={isCollapsed ? "Expand subtasks" : "Collapse subtasks"}
          >
            {isCollapsed ? (
              <CaretRight size={12} weight="bold" />
            ) : (
              <CaretDown size={12} weight="bold" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
      </div>

      {/* Checkbox */}
      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          size="sm"
          aria-label={`Select ${task.title}`}
          checked={isSelected}
          onChange={() => onCheckboxChange()}
        />
      </span>

      {/* Task ID */}
      <span className="text-xs font-mono text-muted-foreground shrink-0">
        {projectSlug}-{task.number}
      </span>

      {/* Status icon */}
      <StatusIcon
        semantic={statusOption ? statusSemanticOf(statusOption) : null}
        color={paint.solid}
      />

      {/* Type + title; a root row with a parent is a subtask whose parent is filtered out */}
      {depth === 0 && task.parentId && (
        <TaskParentChip task={task} projectSlug={projectSlug} className="text-xs max-w-[120px]" />
      )}
      <TaskTypeIcon type={task.taskType} className="text-muted-foreground" />
      <span
        className={cn(
          "flex-1 text-sm truncate",
          hasDates ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {task.title}
      </span>
      <BlockedBadge task={task} variant="icon" />

      {/* Subtask progress */}
      {task.subtaskTotal > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
          <CheckCircle
            size={10}
            className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""}
          />
          {task.subtaskCompleted}/{task.subtaskTotal}
        </span>
      )}

      {/* No dates indicator */}
      {!hasDates && <span className="text-xs text-muted-foreground italic">No dates</span>}

      {/* Assignee avatars */}
      {task.assigneeIds.length > 0 && (
        <div className="shrink-0">
          <SubjectAvatarStack subjectIds={task.assigneeIds} maxDisplay={2} size="xs" />
        </div>
      )}
    </div>
  );
}

interface StatusIconProps {
  semantic: TaskStatusSemantic | null;
  color: string;
}

function StatusIcon({ semantic, color }: StatusIconProps) {
  const iconProps = {
    size: 16,
    weight: "fill" as const,
    className: "shrink-0",
    style: { color },
  };

  if (semantic === "completed") {
    return <CheckCircle {...iconProps} />;
  }
  if (semantic === "in_progress" || semantic === "review") {
    return <Spinner {...iconProps} />;
  }
  return <Circle {...iconProps} />;
}
