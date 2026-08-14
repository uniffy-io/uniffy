import { CaretDown, CaretRight, Lightning } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { LAYOUT } from "@/features/projects/constants";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import type { Task, SelectOption } from "@/features/projects/types";
import { BoardColumn } from "./BoardColumn";
import { buildSwimlaneDropId } from "./swimlaneDropId";

interface BoardSwimlaneProps {
  laneId: string;
  epic: Task | null;
  tasksByStatus: Record<string, Task[]>;
  statusOptions: SelectOption[];
  priorityOptions: SelectOption[];
  selectedTaskIds: string[];
  onTaskClick: (taskId: string, e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  onAddTask: () => void;
  projectSlug: string;
  reparentHintActive: boolean;
  activeDragTaskId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  doneStatusIds: Set<string>;
}

export function BoardSwimlane({
  laneId,
  epic,
  tasksByStatus,
  statusOptions,
  priorityOptions,
  selectedTaskIds,
  onTaskClick,
  onCheckboxChange,
  onAddTask,
  projectSlug,
  reparentHintActive,
  activeDragTaskId,
  collapsed,
  onToggleCollapse,
  doneStatusIds,
}: BoardSwimlaneProps) {
  const { isMobile } = useBreakpoint();

  const totalTasks = statusOptions.reduce((sum, s) => sum + (tasksByStatus[s.id]?.length ?? 0), 0);
  const doneTasks = statusOptions.reduce(
    (sum, s) => sum + (doneStatusIds.has(s.id) ? (tasksByStatus[s.id]?.length ?? 0) : 0),
    0,
  );

  const typeConfig = epic ? getTaskTypeConfig(epic.taskType || "epic") : null;
  const TypeIcon = typeConfig?.icon ?? Lightning;
  const epicStatusOption = epic ? statusOptions.find((o) => o.id === epic.status) : undefined;
  const epicOverdue = epic?.dueDate && isOverdue(epic.dueDate);

  return (
    <div className="flex flex-col mb-3 last:mb-0">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-2 px-3 py-2 bg-muted/60 hover:bg-muted rounded-md text-left transition-colors"
      >
        {collapsed ? (
          <CaretRight size={14} className="text-muted-foreground shrink-0" />
        ) : (
          <CaretDown size={14} className="text-muted-foreground shrink-0" />
        )}
        {epic ? (
          <>
            <TypeIcon size={14} weight="fill" className="text-muted-foreground shrink-0" />
            <span className="font-medium text-sm text-foreground truncate">{epic.title}</span>
            {epicStatusOption && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                style={{
                  backgroundColor: `${epicStatusOption.color}20`,
                  color: epicStatusOption.color,
                }}
              >
                {epicStatusOption.label}
              </span>
            )}
            {epic.dueDate && (
              <span
                className={cn(
                  "text-[10px] shrink-0",
                  epicOverdue ? "text-destructive font-medium" : "text-muted-foreground",
                )}
              >
                Due {formatDateShort(epic.dueDate)}
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground italic">No Epic</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
          {doneTasks}/{totalTasks}
        </span>
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
          {statusOptions.map((status) => (
            <BoardColumn
              key={status.id}
              statusOption={status}
              tasks={tasksByStatus[status.id] || []}
              priorityOptions={priorityOptions}
              selectedTaskIds={selectedTaskIds}
              onTaskClick={onTaskClick}
              onCheckboxChange={onCheckboxChange}
              onAddTask={onAddTask}
              projectSlug={projectSlug}
              reparentHintActive={reparentHintActive}
              activeDragTaskId={activeDragTaskId}
              dropId={buildSwimlaneDropId(laneId, status.id)}
              showHeader={false}
              showFooter={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SwimlaneStatusHeaderRowProps {
  statusOptions: SelectOption[];
}

export function SwimlaneStatusHeaderRow({ statusOptions }: SwimlaneStatusHeaderRowProps) {
  const { isMobile } = useBreakpoint();
  const columnWidth = isMobile ? 280 : LAYOUT.BOARD_COLUMN_WIDTH;

  return (
    <div className="flex gap-4 mb-2 min-w-max sticky top-0 z-10">
      {statusOptions.map((status) => (
        <div
          key={status.id}
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card"
          style={{ width: columnWidth }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
          />
          <span className="font-medium text-sm text-foreground truncate">{status.label}</span>
        </div>
      ))}
    </div>
  );
}
