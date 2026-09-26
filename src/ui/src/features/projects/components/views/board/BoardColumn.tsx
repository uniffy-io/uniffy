import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { LAYOUT } from "@/features/projects/constants";
import type { StatusPaint } from "@/features/projects/utils/statusPaint";
import type { GroupSum } from "@/features/projects/utils/groupTasks";
import type { Task, SelectOption } from "@/features/projects/types";
import { GroupHeaderStats } from "@/features/projects/components/views/GroupHeaderLabel";
import { TaskCard } from "./TaskCard";
import { buildLaneCardId } from "./boardDropIds";

interface BoardColumnProps {
  label: string;
  paint: StatusPaint;
  tasks: Task[];
  priorityOptions: SelectOption[];
  onTaskClick: (taskId: string) => void;
  onAddTask?: () => void;
  projectSlug: string;
  reparentHintActive?: boolean;
  activeDragTaskId?: string | null;
  dropId: string;
  /** Lane the cards are drawn in, so a task shown in two lanes gets two drag ids. */
  laneKey: string;
  sums?: readonly GroupSum[];
  showHeader?: boolean;
  showFooter?: boolean;
}

export function BoardColumn({
  label,
  paint,
  tasks,
  priorityOptions,
  onTaskClick,
  onAddTask,
  projectSlug,
  reparentHintActive = false,
  activeDragTaskId = null,
  dropId,
  laneKey,
  sums = [],
  showHeader = true,
  showFooter = true,
}: BoardColumnProps) {
  const { isMobile } = useBreakpoint();
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const cardIds = tasks.map((task) => buildLaneCardId(laneKey, task.id));

  const getPriorityOption = (priorityId: string | null) => {
    if (!priorityId) return undefined;
    return priorityOptions.find((o) => o.id === priorityId);
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-muted/30 dark:bg-muted/60 rounded-lg"
      style={{ width: isMobile ? 280 : LAYOUT.BOARD_COLUMN_WIDTH }}
    >
      {showHeader && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: paint.gradient }}
          />
          <span className="font-medium text-sm text-foreground truncate shrink-0 max-w-[50%]">
            {label}
          </span>
          <GroupHeaderStats count={tasks.length} sums={sums} />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div
          ref={setNodeRef}
          className={cn(
            "p-2 space-y-2 min-h-[200px]",
            isOver && "bg-primary/5 ring-2 ring-primary/20 ring-inset rounded",
          )}
        >
          <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
            {tasks.map((task, index) => (
              <TaskCard
                key={cardIds[index]}
                sortableId={cardIds[index]}
                task={task}
                priorityOption={getPriorityOption(task.priority)}
                onClick={() => onTaskClick(task.id)}
                projectSlug={projectSlug}
                reparentHintActive={
                  reparentHintActive && activeDragTaskId !== null && activeDragTaskId !== task.id
                }
              />
            ))}
          </SortableContext>

          {tasks.length === 0 && (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground border-2 border-dashed border-border rounded-lg">
              Drop tasks here
            </div>
          )}
        </div>
      </ScrollArea>

      {showFooter && onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border-t border-border"
        >
          <Plus size={14} />
          <span>Add task</span>
        </button>
      )}
    </div>
  );
}
