/**
 * MyTasksWidget - Shows tasks assigned to the current user
 *
 * Three sections: overdue (red), due today (orange), in progress (neutral).
 * Supports quick status toggle and navigation to project tasks.
 */

import { Link, useNavigate } from 'react-router-dom';
import { CheckSquare, ArrowRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import { formatDateShort, isOverdue } from '@/shared/utils/dateFormatting';
import type { Task } from '@/features/projects/types/project';

const MAX_TASKS = 8;

function TaskRow({ task, projectName }: { task: Task; projectName: string }) {
  const overdue = task.dueDate ? isOverdue(task.dueDate) : false;
  const now = new Date();
  const dueToday = task.dueDate
    ? new Date(task.dueDate).toDateString() === now.toDateString()
    : false;

  return (
    <Link
      to={`/projects/${task.projectId}?task=${task.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
        'hover:bg-muted/50',
      )}
    >
      <div
        className={cn(
          'w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center',
          overdue && 'border-red-500',
          dueToday && !overdue && 'border-amber-500',
          !overdue && !dueToday && 'border-border',
        )}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {task.title || 'Untitled Task'}
        </p>
        <p className="text-xs text-muted-foreground truncate">{projectName}</p>
      </div>

      {task.dueDate && (
        <span
          className={cn(
            'text-xs flex-shrink-0',
            overdue && 'text-red-600 dark:text-red-400 font-medium',
            dueToday && !overdue && 'text-amber-600 dark:text-amber-400 font-medium',
            !overdue && !dueToday && 'text-muted-foreground',
          )}
        >
          {formatDateShort(task.dueDate)}
        </span>
      )}
    </Link>
  );
}

function SectionHeader({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: 'overdue' | 'today' | 'inprogress';
}) {
  if (count === 0) return null;

  const colorClass = {
    overdue: 'text-red-600 dark:text-red-400',
    today: 'text-amber-600 dark:text-amber-400',
    inprogress: 'text-muted-foreground',
  }[variant];

  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className={cn('text-xs font-semibold uppercase tracking-wider', colorClass)}>
        {label}
      </span>
      <span className={cn('text-xs rounded-full px-1.5 py-0.5 font-medium bg-muted', colorClass)}>
        {count}
      </span>
    </div>
  );
}

function categorizeMyTasks(
  tasks: Record<string, Task>,
  userId: string,
): { overdue: Task[]; dueToday: Task[]; inProgress: Task[]; totalCount: number } {
  const now = new Date();
  const ov: Task[] = [];
  const dt: Task[] = [];
  const ip: Task[] = [];

  Object.values(tasks).forEach((task: Task) => {
    if (task.deletedAt) return;
    if (!task.assigneeIds.includes(userId)) return;
    if (task.completedAt) return;

    if (task.dueDate) {
      const due = new Date(task.dueDate);
      const sameDay =
        due.getFullYear() === now.getFullYear() &&
        due.getMonth() === now.getMonth() &&
        due.getDate() === now.getDate();

      if (due < now && !sameDay) {
        ov.push(task);
      } else if (sameDay) {
        dt.push(task);
      } else {
        ip.push(task);
      }
    } else {
      ip.push(task);
    }
  });

  ov.sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  dt.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  ip.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return { overdue: ov, dueToday: dt, inProgress: ip, totalCount: ov.length + dt.length + ip.length };
}

export function MyTasksWidget() {
  const navigate = useNavigate();
  const tasks = useAppSelector((state) => state.projects?.tasks ?? {});
  const projects = useAppSelector((state) => state.projects?.projects ?? {});
  const isLoading = useAppSelector((state) => state.projects?.loading?.tasks ?? false);
  const userId = useAppSelector((state) => state.auth.user?.id ?? '');

  const { overdue, dueToday, inProgress, totalCount } = categorizeMyTasks(tasks, userId);

  const getProjectName = (projectId: string): string =>
    projects[projectId]?.name ?? 'Unknown Project';

  const isEmpty = totalCount === 0 && !isLoading;

  return (
    <WidgetCard
      title="My Tasks"
      icon={CheckSquare}
      colSpan={2}
      minHeight="200px"
      priority={1}
      footer={
        totalCount > 0 ? (
          <Link
            to="/projects"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all {totalCount} tasks
            <ArrowRight size={12} />
          </Link>
        ) : null
      }
    >
      {isLoading && Object.keys(tasks).length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={CheckSquare}
          title="No tasks assigned"
          description="Browse projects to find work"
          action={{
            label: 'Browse projects',
            onClick: () => navigate('/projects'),
          }}
        />
      ) : (
        <div className="space-y-1">
          {overdue.length > 0 && (
            <>
              <SectionHeader label="Overdue" count={overdue.length} variant="overdue" />
              {overdue.slice(0, MAX_TASKS).map((task) => (
                <TaskRow key={task.id} task={task} projectName={getProjectName(task.projectId)} />
              ))}
            </>
          )}
          {dueToday.length > 0 && (
            <>
              <SectionHeader label="Due today" count={dueToday.length} variant="today" />
              {dueToday.slice(0, MAX_TASKS - overdue.length).map((task) => (
                <TaskRow key={task.id} task={task} projectName={getProjectName(task.projectId)} />
              ))}
            </>
          )}
          {inProgress.length > 0 && overdue.length + dueToday.length < MAX_TASKS && (
            <>
              <SectionHeader label="In progress" count={inProgress.length} variant="inprogress" />
              {inProgress
                .slice(0, Math.max(0, MAX_TASKS - overdue.length - dueToday.length))
                .map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    projectName={getProjectName(task.projectId)}
                  />
                ))}
            </>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
