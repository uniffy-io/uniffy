import { Plus } from "@phosphor-icons/react";
import { EmptyState as SharedEmptyState } from "@/components/feedback/EmptyState";

interface EmptyStateProps {
  onCreateTask?: () => void;
}

export function EmptyState({ onCreateTask }: EmptyStateProps) {
  return (
    <SharedEmptyState
      icon={Plus}
      title={onCreateTask ? "Create your first task" : "No tasks yet"}
      description={
        onCreateTask
          ? "Start building your project by adding tasks. You can organize them in Table, Board, or Roadmap views."
          : "Tasks added to this project will show up here."
      }
      actionLabel={onCreateTask ? "New Task" : undefined}
      onAction={onCreateTask}
      shortcutKey={onCreateTask ? "projects.newTask" : undefined}
      tips={[
        {
          color: "primary",
          text: (
            <>
              Use <kbd className="px-1 rounded bg-muted text-xs">@</kbd> in task descriptions to
              reference Notes, Files, or Chats
            </>
          ),
        },
        {
          color: "emerald-500",
          text: "Drag tasks between Board columns to update status",
        },
        {
          color: "amber-500",
          text: "Add Start and Due dates to see tasks in Roadmap view",
        },
      ]}
    />
  );
}
