import type { Project } from "@/features/projects/types";

export interface ProjectStats {
  totalTasks: number;
  completedTasks: number;
  completionPct: number;
  overdueTasks: number;
  totalEstimated: number;
  totalSpent: number;
}

export type HealthStatus = "on_track" | "at_risk" | "behind" | "not_started";

export function computeHealth(stats: ProjectStats): HealthStatus {
  if (stats.totalTasks === 0) return "not_started";
  if (stats.completedTasks === 0 && stats.overdueTasks === 0) return "not_started";
  if (stats.overdueTasks >= 3) return "behind";
  if (stats.totalEstimated > 0 && stats.totalSpent > stats.totalEstimated) return "behind";
  if (stats.overdueTasks >= 1) return "at_risk";
  if (stats.totalEstimated > 0 && stats.totalSpent > stats.totalEstimated * 0.8) return "at_risk";
  return "on_track";
}

export const HEALTH_CONFIG: Record<HealthStatus, { label: string; className: string }> = {
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
export function projectStats(project: Project): ProjectStats {
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
