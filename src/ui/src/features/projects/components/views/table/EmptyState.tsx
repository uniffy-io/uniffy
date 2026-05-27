import { Plus } from "@phosphor-icons/react";
import { EmptyState as SharedEmptyState } from "@/components/feedback/EmptyState";

interface EmptyStateProps {
  onCreateTask: () => void;
}

export function EmptyState({ onCreateTask }: EmptyStateProps) {
  return (
    <SharedEmptyState
      icon={Plus}
      title="Create your first task"
      description="Start building your project by adding tasks. You can organize them in Table, Board, or Roadmap views."
      actionLabel="New Task"
      onAction={onCreateTask}
      shortcutKey="projects.newTask"
      tips={[
        {
          color: 'primary',
          text: (
            <>
              Use <kbd className="px-1 rounded bg-muted text-xs">@</kbd> in task descriptions to reference Notes, Files, or Chats
            </>
          ),
        },
        {
          color: 'emerald-500',
          text: 'Drag tasks between Board columns to update status',
        },
        {
          color: 'amber-500',
          text: 'Add Start and Due dates to see tasks in Roadmap view',
        },
      ]}
    />
  );
}
