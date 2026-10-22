import { useEffect, useMemo } from "react";
import { Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import type { Task } from "@/features/projects/types";
import { selectTaskListLoadedIds } from "@/features/projects/store/projectsSlice";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { addDays } from "@/features/projects/utils/timeWeek";
import type { WeekRowRef } from "@/features/projects/utils/timeWeek";

const RECENT_DAYS = 14;
const MAX_ITEMS = 30;

interface RecentTasksRailProps {
  /** Tasks of the org's internal project are pinned first, whoever they are assigned to. */
  pinnedProjectId: string | null;
  /** Rows already in the week; those tasks are hidden from the rail. */
  excludeTaskIds: ReadonlySet<string>;
  onPick: (row: WeekRowRef) => void;
}

function TaskItem({ task, slug, onPick }: { task: Task; slug: string; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60 transition-colors"
        data-testid="recent-task"
      >
        <span className="shrink-0 font-mono text-muted-foreground">
          {slug.toUpperCase()}-{task.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
        <Plus
          size={12}
          className="mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
        />
      </button>
    </li>
  );
}

/** Tasks assigned to the viewer and touched in the last two weeks, one click away from a row. */
export function RecentTasksRail({ pinnedProjectId, excludeTaskIds, onPick }: RecentTasksRailProps) {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const projects = useAppSelector((state) => state.projects.projects);
  const tasks = useAppSelector((state) => state.projects.tasks);
  const loadedIds = useAppSelector(selectTaskListLoadedIds);

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  // One sample page per project keeps the rail cheap; a project opened earlier already holds its tasks.
  useEffect(() => {
    for (const projectId of Object.keys(projects)) {
      if (!loadedIds[projectId]) dispatch(fetchProjectTasks({ projectId, firstPageOnly: true }));
    }
  }, [dispatch, projects, loadedIds]);

  const { pinned, recent } = useMemo(() => {
    const since = addDays(effectiveDayKey(new Date()), -RECENT_DAYS);
    const candidates = Object.values(tasks).filter(
      (task) => !task.completedAt && !excludeTaskIds.has(task.id),
    );
    const pinnedTasks = pinnedProjectId
      ? candidates
          .filter((task) => task.projectId === pinnedProjectId)
          .sort((a, b) => a.number - b.number)
      : [];
    const recentTasks = candidates
      .filter(
        (task) =>
          task.projectId !== pinnedProjectId &&
          task.assigneeIds.includes(userId) &&
          task.updatedAt.slice(0, 10) >= since,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_ITEMS);
    return { pinned: pinnedTasks, recent: recentTasks };
  }, [tasks, userId, pinnedProjectId, excludeTaskIds]);

  const slugOf = (task: Task) => projects[task.projectId]?.slug ?? "";
  const pick = (task: Task) => onPick({ taskId: task.id, projectId: task.projectId });

  return (
    <aside
      className="flex h-full w-full flex-col border-l border-border bg-surface"
      data-testid="recent-tasks-rail"
    >
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
        Add a row
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {pinned.length > 0 && (
          <>
            <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-subtle-foreground">
              Internal
            </div>
            <ul>
              {pinned.map((task) => (
                <TaskItem key={task.id} task={task} slug={slugOf(task)} onPick={() => pick(task)} />
              ))}
            </ul>
          </>
        )}
        <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-subtle-foreground">
          Recent
        </div>
        {recent.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-subtle-foreground">
            No tasks assigned to you were updated in the last {RECENT_DAYS} days.
          </p>
        ) : (
          <ul>
            {recent.map((task) => (
              <TaskItem key={task.id} task={task} slug={slugOf(task)} onPick={() => pick(task)} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
