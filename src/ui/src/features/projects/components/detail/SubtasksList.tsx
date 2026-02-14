import { Plus, Circle, CheckCircle } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";
import { selectSubtasksByParentId } from "../../store/projectsSlice";
import type { Task } from "../../types/project";

interface SubtasksListProps {
  taskId: string;
}

export function SubtasksList({ taskId }: SubtasksListProps) {
  const subtasks = useAppSelector(selectSubtasksByParentId(taskId));

  const handleAddSubtask = () => {
    // No-op until subtask creation thunk is implemented
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Subtasks
        </h3>
        <span className="text-xs text-muted-foreground">
          {subtasks.filter(t => t.completedAt).length}/{subtasks.length}
        </span>
      </div>

      <div className="space-y-1">
        {subtasks.length === 0 ? (
          <div className="text-sm text-muted-foreground italic px-2">
            No subtasks
          </div>
        ) : (
          subtasks.map(task => (
            <SubtaskItem key={task.id} task={task} />
          ))
        )}
      </div>

      <Button 
        variant="ghost" 
        size="sm" 
        className="w-full justify-start text-muted-foreground h-8 px-2 hover:bg-transparent hover:text-foreground"
        onClick={handleAddSubtask}
      >
        <Plus className="mr-2 h-3.5 w-3.5" />
        Add subtask
      </Button>
    </div>
  );
}

function SubtaskItem({ task }: { task: Task }) {
  const isCompleted = !!task.completedAt;

  return (
    <div className="group flex items-center gap-2 py-1 px-2 rounded-md hover:bg-muted/50">
      <button className="text-muted-foreground hover:text-primary transition-colors">
        {isCompleted ? (
          <CheckCircle className="h-4 w-4 text-primary" weight="fill" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>
      <span className={cn(
        "text-sm flex-1 truncate",
        isCompleted && "text-muted-foreground line-through"
      )}>
        {task.title}
      </span>
    </div>
  );
}
