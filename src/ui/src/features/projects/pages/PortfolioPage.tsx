import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Clock, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { ExportTasksModal } from "@/features/projects/components/modals/ExportTasksModal";
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
  on_track: {
    label: "On Track",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  at_risk: {
    label: "At Risk",
    className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  behind: {
    label: "Behind",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
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
      project.taskCount > 0
        ? Math.round((project.completedTaskCount / project.taskCount) * 100)
        : 0,
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isExportOpen, setIsExportOpen] = useState(false);
  // A project that left the list (deleted, access removed) drops out of the selection.
  const selectedIds = useMemo(
    () => projects.filter((project) => selected.has(project.id)).map((project) => project.id),
    [projects, selected],
  );
  const selecting = selectedIds.length > 0;

  const toggleSelected = (projectId: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

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
        <p className="text-sm text-muted-foreground">
          No projects yet. Create your first project to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selecting
              ? `${selectedIds.length} of ${projects.length} selected`
              : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selecting ? (
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set(projects.map((project) => project.id)))}
            >
              Select all
            </Button>
          )}
          <Button
            className="gap-1.5"
            disabled={!selecting}
            onClick={() => setIsExportOpen(true)}
            title={selecting ? undefined : "Select projects to export their tasks"}
          >
            <DownloadSimple size={16} />
            {selecting ? `Export ${selectedIds.length}` : "Export"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projectCards.map(({ project, stats }) => {
          const health = computeHealth(stats);
          const healthConfig = HEALTH_CONFIG[health];

          return (
            <Card
              key={project.id}
              className={cn(
                "group p-4 cursor-pointer transition-shadow duration-150 hover:shadow-edge-strong",
                selected.has(project.id) && "bg-primary/5 shadow-edge-primary",
              )}
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={cn(
                    "shrink-0 transition-opacity",
                    !selecting &&
                      "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={`Select ${project.name}`}
                    checked={selected.has(project.id)}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                  />
                </div>
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
                <span
                  className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
                    healthConfig.className,
                  )}
                >
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
                <span>
                  {stats.completedTasks}/{stats.totalTasks} done ({stats.completionPct}%)
                </span>

                {stats.overdueTasks > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500">
                    <WarningCircle size={10} weight="fill" />
                    {stats.overdueTasks} overdue
                  </span>
                )}

                {stats.totalEstimated > 0 && (
                  <span
                    className={cn(
                      "flex items-center gap-0.5",
                      stats.totalSpent > stats.totalEstimated
                        ? "text-red-500"
                        : "text-muted-foreground",
                    )}
                  >
                    <Clock size={10} />
                    {formatMinutes(stats.totalSpent)} / {formatMinutes(stats.totalEstimated)}
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {isExportOpen && (
        <ExportTasksModal projectIds={selectedIds} onClose={() => setIsExportOpen(false)} />
      )}
    </div>
  );
}
