import { Kanban } from '@phosphor-icons/react';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useAppDispatch } from '@/app/hooks';
import { openCreateProjectModal } from '@/features/projects/store/projectsUiSlice';

export function ProjectsEmptyState() {
  const dispatch = useAppDispatch();

  return (
    <EmptyState
      icon={Kanban}
      title="Create your first project"
      description="Projects help you organize tasks, track progress, and collaborate with your team across Table, Board, and Roadmap views."
      actionLabel="New Project"
      onAction={() => dispatch(openCreateProjectModal())}
      shortcutKey="projects.newProject"
      tips={[
        {
          color: 'primary',
          text: (
            <>
              Use <kbd className="px-1 rounded bg-muted text-xs">@</kbd> in task descriptions to reference Notes, Files, or People
            </>
          ),
        },
        {
          color: 'emerald-500',
          text: 'Switch between Table, Board, Roadmap, and Graph views',
        },
        {
          color: 'amber-500',
          text: 'Add due dates and assignees to track team progress',
        },
      ]}
    />
  );
}
