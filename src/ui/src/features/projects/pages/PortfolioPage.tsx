import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Clock, WarningCircle } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { selectProjects } from "@/features/projects/store/projectsSlice";
import { fetchProjects } from "@/features/projects/store/projectsThunks";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import type { Project } from "@/features/projects/types";

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

/**
 * Read off the project row rather than recomputed from tasks: the server sums
 * the whole tree in one query, so the numbers match the mobile app and stay
 * exact past the task-list page size.
 */
function projectStats(project: Project): ProjectStats {
  return {
    totalTasks: project.taskCount,
    completedTasks: project.completedTaskCount,
    completionPct:
      project.taskCount > 0 ? Math.round((project.completedTaskCount / project.taskCount) * 100) : 0,
    overdueTasks: project.overdueTaskCount,
    totalEstimated: project.estimatedMinutes,
    totalSpent: project.timeSpentMinutes,
  };
}

export function PortfolioPage() {
  useDocumentTitle("Portfolio");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const projects = useAppSelector(selectProjects);

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  const projectCards = useMemo(
    () => projects.map((project) => ({ project, stats: projectStats(project) })),
    [projects],
  );

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
