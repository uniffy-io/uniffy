import { useAppDispatch } from "@/app/hooks";
import { DurationInput } from "@/components/ui/duration-input";
import { optimisticUpdateTask } from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import type { Task } from "@/features/projects/types";
import { formatMinutes } from "@/shared/utils/durationFormatting";

interface TimeColumnCellProps {
  task: Task;
  kind: "estimate" | "spent";
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
}

/** Estimate edits inline; Spent is the sum of the task's time entries and never typed. */
export function TimeColumnCell({
  task,
  kind,
  isEditing,
  onStartEdit,
  onEndEdit,
}: TimeColumnCellProps) {
  const dispatch = useAppDispatch();

  if (kind === "spent") {
    return (
      <span className="text-sm truncate" title="Sum of the task's time entries">
        {task.timeSpentMinutes ? formatMinutes(task.timeSpentMinutes) : ""}
      </span>
    );
  }

  if (!isEditing) {
    return (
      <div
        className="w-full h-full flex items-center"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit();
        }}
      >
        <span className="text-sm truncate">
          {task.estimatedMinutes ? formatMinutes(task.estimatedMinutes) : ""}
        </span>
      </div>
    );
  }

  return (
    <DurationInput
      autoFocus
      className="h-7 px-1.5 text-xs"
      minutes={task.estimatedMinutes}
      onChange={(minutes) => {
        if (minutes !== task.estimatedMinutes) {
          dispatch(optimisticUpdateTask({ id: task.id, estimatedMinutes: minutes }));
          dispatch(updateTask({ id: task.id, estimatedMinutes: minutes }));
        }
        onEndEdit();
      }}
      onCancel={onEndEdit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
