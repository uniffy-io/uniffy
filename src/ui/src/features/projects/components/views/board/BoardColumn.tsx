import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { LAYOUT } from "../../../constants";
import type { Task, SelectOption } from "../../../types";
import { TaskCard } from "./TaskCard";

interface BoardColumnProps {
  statusOption: SelectOption;
  tasks: Task[];
  priorityOptions: SelectOption[];
  selectedTaskIds: string[];
  onTaskClick: (taskId: string, e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  onAddTask?: () => void;
  projectSlug: string;
  reparentHintActive?: boolean;
  activeDragTaskId?: string | null;
  dropId?: string;
  showHeader?: boolean;
  showFooter?: boolean;
}

export function BoardColumn({
  statusOption,
  tasks,
  priorityOptions,
  selectedTaskIds,
  onTaskClick,
  onCheckboxChange,
  onAddTask,
  projectSlug,
  reparentHintActive = false,
  activeDragTaskId = null,
  dropId,
  showHeader = true,
  showFooter = true,
}: BoardColumnProps) {
  const { isMobile } = useBreakpoint();
  const { setNodeRef, isOver } = useDroppable({
    id: dropId ?? statusOption.id,
  });

  // Get priority option for a task
  const getPriorityOption = (priorityId: string | null) => {
    if (!priorityId) return undefined;
    return priorityOptions.find((o) => o.id === priorityId);
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-muted/30 rounded-lg"
      style={{ width: isMobile ? 280 : LAYOUT.BOARD_COLUMN_WIDTH }}
    >
      {showHeader && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: statusOption.color }}
          />
          <span className="font-medium text-sm text-foreground truncate">{statusOption.label}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {tasks.length}
          </span>
        </div>
      )}

      {/* Cards Area */}
      <ScrollArea className="flex-1">
        <div
          ref={setNodeRef}
          className={cn(
            "p-2 space-y-2 min-h-[200px]",
            isOver && "bg-primary/5 ring-2 ring-primary/20 ring-inset rounded",
          )}
        >
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                statusOption={statusOption}
                priorityOption={getPriorityOption(task.priority)}
                onClick={(e) => onTaskClick(task.id, e)}
                onCheckboxChange={onCheckboxChange}
                isSelected={selectedTaskIds.includes(task.id)}
                projectSlug={projectSlug}
                reparentHintActive={
                  reparentHintActive && activeDragTaskId !== null && activeDragTaskId !== task.id
                }
              />
            ))}
          </SortableContext>

          {/* Empty state for column */}
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
