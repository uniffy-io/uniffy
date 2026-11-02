import { Link } from "react-router-dom";
import { Heartbeat } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget } from "@/features/dashboard/types";
import {
  HEALTH_CONFIG,
  computeHealth,
  projectStats,
} from "@/features/projects/utils/projectHealth";
import { cn } from "@/shared/utils/cn";

const ROWS = 6;
const IN_SCOPE_LIMIT = 50;

/**
 * Health comes off each project's server rollup, the same numbers the portfolio shows; the
 * metric only decides which projects the widget's filters reach.
 */
export function ProjectHealthWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(
    widget.id,
    "status_by_project",
    widget.filters,
    IN_SCOPE_LIMIT,
  );
  const projects = useAppSelector((state) => state.projects.projects);
  const rows = (data?.statusByProject ?? [])
    .map((row) => projects[row.projectId])
    .filter((project) => project !== undefined)
    .map((project) => {
      const stats = projectStats(project);
      return { project, stats, health: computeHealth(stats) };
    });
  const rank = { behind: 0, at_risk: 1, on_track: 2, not_started: 3 } as const;
  rows.sort(
    (a, b) => rank[a.health] - rank[b.health] || a.project.name.localeCompare(b.project.name),
  );
  const atRisk = rows.filter((row) => row.health === "behind" || row.health === "at_risk").length;

  return (
    <MetricWidgetCard
      widget={widget}
      title="Project health"
      icon={Heartbeat}
      colSpan={2}
      loading={loading}
      failed={failed}
      count={atRisk}
      footer={
        <Link to="/portfolio" className="text-xs font-medium text-primary hover:text-primary/80">
          Open portfolio
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyWidget
          icon={Heartbeat}
          title="No projects to show"
          description="Projects with tasks appear here."
        />
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, ROWS).map(({ project, stats, health }) => (
            <li key={project.id} className="flex items-center gap-3">
              <Link
                to={`/projects/${project.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary"
              >
                {project.name}
              </Link>
              <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                {stats.completionPct}%
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  HEALTH_CONFIG[health].className,
                )}
              >
                {HEALTH_CONFIG[health].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </MetricWidgetCard>
  );
}
