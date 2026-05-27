import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Clock, WarningCircle } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { isOverdue } from "@/shared/utils/dateFormatting";
import { selectProjects, selectAllTasks } from "@/features/projects/store/projectsSlice";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import type { Task } from "@/features/projects/types";

interface ProjectStats {
  totalTasks: number;
  completedTasks: number;
  completionPct: number;
  overdueTasks: number;
  totalEstimated: number;
  totalSpent: number;
}

type HealthStatus = "on_track" | "at_risk" | "behind" | "not_started";

function computeHealth(stats: ProjectStats): HealthStatus {
  if (stats.totalTasks === 0) return "not_started";
  if (stats.completedTasks === 0 && stats.overdueTasks === 0) return "not_started";
  if (stats.overdueTasks >= 3) return "behind";
  if (stats.totalEstimated > 0 && stats.totalSpent > stats.totalEstimated) return "behind";
  if (stats.overdueTasks >= 1) return "at_risk";
  if (stats.totalEstimated > 0 && stats.totalSpent > stats.totalEstimated * 0.8) return "at_risk";
  return "on_track";
}

const HEALTH_CONFIG: Record<HealthStatus, { label: string; className: string }> = {
  on_track: { label: "On Track", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  at_risk: { label: "At Risk", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  behind: { label: "Behind", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  not_started: { label: "Not Started", className: "bg-muted text-muted-foreground" },
};

function computeProjectStats(tasks: Task[]): ProjectStats {
  let totalTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  let totalEstimated = 0;
  let totalSpent = 0;

  for (const task of tasks) {
    if (task.parentId) continue;
    totalTasks++;
    if (task.completedAt) completedTasks++;
    if (!task.completedAt && task.dueDate && isOverdue(task.dueDate)) overdueTasks++;
    if (task.estimatedMinutes) totalEstimated += task.estimatedMinutes;
    if (task.timeSpentMinutes) totalSpent += task.timeSpentMinutes;
  }

  return {
    totalTasks,
    completedTasks,
    completionPct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    overdueTasks,
    totalEstimated,
    totalSpent,
  };
}

export function PortfolioPage() {
  useDocumentTitle("Portfolio");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const projects = useAppSelector(selectProjects);
  const allTasks = useAppSelector(selectAllTasks);

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  useEffect(() => {
    for (const project of projects) {
      dispatch(fetchProjectTasks(project.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when project list changes
  }, [projects.length, dispatch]);

  const projectCards = useMemo(() => {
    const tasksByProject: Record<string, Task[]> = {};
    for (const task of allTasks) {
      if (!tasksByProject[task.projectId]) tasksByProject[task.projectId] = [];
      tasksByProject[task.projectId].push(task);
    }

    return projects.map((project) => ({
      project,
      stats: computeProjectStats(tasksByProject[project.id] ?? []),
    }));
  }, [projects, allTasks]);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Briefcase size={48} className="text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">No projects yet. Create your first project to get started.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Portfolio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projectCards.map(({ project, stats }) => {
          const health = computeHealth(stats);
          const healthConfig = HEALTH_CONFIG[health];

          return (
            <div
              key={project.id}
              className="border border-border rounded-lg p-4 hover:bg-muted/30 cursor-pointer transition-colors bg-card"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="flex items-center gap-3 mb-3">
                <ProjectIcon
                  icon={project.icon}
                  size={20}
                  weight="duotone"
                  className="shrink-0"
                  style={{ color: project.color }}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate">{project.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {stats.totalTasks} task{stats.totalTasks !== 1 ? "s" : ""}
                  </p>
                </div>
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0", healthConfig.className)}>
                  {healthConfig.label}
                </span>
              </div>

              {stats.totalTasks > 0 && (
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${stats.completionPct}%` }}
                  />
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>{stats.completedTasks}/{stats.totalTasks} done ({stats.completionPct}%)</span>

                {stats.overdueTasks > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500">
                    <WarningCircle size={10} weight="fill" />
                    {stats.overdueTasks} overdue
                  </span>
                )}

                {stats.totalEstimated > 0 && (
                  <span className={cn(
                    "flex items-center gap-0.5",
                    stats.totalSpent > stats.totalEstimated ? "text-red-500" : "text-muted-foreground"
                  )}>
                    <Clock size={10} />
                    {formatMinutes(stats.totalSpent)} / {formatMinutes(stats.totalEstimated)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
