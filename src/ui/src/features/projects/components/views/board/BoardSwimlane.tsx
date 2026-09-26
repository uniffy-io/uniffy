import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { LAYOUT } from "@/features/projects/constants";
import { statusPaint, type StatusPaint } from "@/features/projects/utils/statusPaint";
import type { GroupSum, TaskGroup } from "@/features/projects/utils/groupTasks";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import type { Task, SelectOption } from "@/features/projects/types";
import {
  GroupHeaderLabel,
  GroupHeaderStats,
} from "@/features/projects/components/views/GroupHeaderLabel";
import { BoardColumn } from "./BoardColumn";
import { buildLaneDropId } from "./boardDropIds";

export interface BoardColumnSpec {
  key: string;
  label: string;
  paint: StatusPaint;
}

interface BoardSwimlaneProps {
  group: TaskGroup;
  /** The epic the lane stands for, when lanes are epics. */
  epic: Task | null;
  columns: BoardColumnSpec[];
  tasksByColumn: Record<string, Task[]>;
  sums: readonly GroupSum[];
  doneCount: number;
  statusOptions: SelectOption[];
  priorityOptions: SelectOption[];
  onTaskClick: (taskId: string) => void;
  onAddTask?: () => void;
  projectSlug: string;
  reparentHintActive: boolean;
  activeDragTaskId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function BoardSwimlane({
  group,
  epic,
  columns,
  tasksByColumn,
  sums,
  doneCount,
  statusOptions,
  priorityOptions,
  onTaskClick,
  onAddTask,
  projectSlug,
  reparentHintActive,
  activeDragTaskId,
  collapsed,
  onToggleCollapse,
}: BoardSwimlaneProps) {
  const { isMobile } = useBreakpoint();

  const epicStatusOption = epic ? statusOptions.find((o) => o.id === epic.status) : undefined;
  const epicPaint = epicStatusOption ? statusPaint(statusOptions, epicStatusOption.id) : null;
  const epicOverdue = !!epic && !epic.completedAt && !!epic.dueDate && isOverdue(epic.dueDate);

  return (
    <div className="flex flex-col mb-3 last:mb-0">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 px-3 min-h-11 md:min-h-9 py-2 bg-muted/60 hover:bg-muted rounded-md text-left transition-colors"
      >
        {collapsed ? (
          <CaretRight size={14} className="text-muted-foreground shrink-0" />
        ) : (
          <CaretDown size={14} className="text-muted-foreground shrink-0" />
        )}
        <GroupHeaderLabel group={group} className="shrink min-w-0" />
        {epicStatusOption && epicPaint && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={{ backgroundColor: epicPaint.translucent, color: epicPaint.solid }}
          >
            {epicStatusOption.label}
          </span>
        )}
        {epic?.dueDate && (
          <span
            className={cn(
              "text-[10px] shrink-0",
              epicOverdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground",
            )}
          >
            Due {formatDateShort(epic.dueDate)}
          </span>
        )}
        <span
          className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0"
          title={`${doneCount} of ${group.tasks.length} done`}
        >
          {doneCount}/{group.tasks.length}
        </span>
        {/* Beside the label, not at the far edge: a wide board scrolls that edge out of view. */}
        <GroupHeaderStats sums={sums} className="shrink" />
      </button>

      {!collapsed && (
        <div
          className="flex gap-4 mt-2 min-w-max"
          style={{
            // Reserve a stable height even when all columns are empty so the
            // lane stays visible as a drop target.
            minHeight: isMobile ? 140 : 180,
          }}
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.key}
              label={column.label}
              paint={column.paint}
              tasks={tasksByColumn[column.key] ?? []}
              priorityOptions={priorityOptions}
              onTaskClick={onTaskClick}
              onAddTask={onAddTask}
              projectSlug={projectSlug}
              reparentHintActive={reparentHintActive}
              activeDragTaskId={activeDragTaskId}
              dropId={buildLaneDropId(group.key, column.key)}
              laneKey={group.key}
              showHeader={false}
              showFooter={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SwimlaneColumnHeaderRow({ columns }: { columns: BoardColumnSpec[] }) {
  const { isMobile } = useBreakpoint();
  const columnWidth = isMobile ? 280 : LAYOUT.BOARD_COLUMN_WIDTH;

  return (
    <div className="flex gap-4 mb-2 min-w-max sticky top-0 z-10">
      {columns.map((column) => (
        <div
          key={column.key}
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card"
          style={{ width: columnWidth }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: column.paint.gradient }}
          />
          <span className="font-medium text-sm text-foreground truncate">{column.label}</span>
        </div>
      ))}
    </div>
  );
}
