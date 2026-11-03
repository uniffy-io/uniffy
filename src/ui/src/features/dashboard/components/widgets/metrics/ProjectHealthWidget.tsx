import { Link } from "react-router-dom";
import { Heartbeat } from "@phosphor-icons/react";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget } from "@/features/dashboard/types";
import { HEALTH_CONFIG, computeHealth } from "@/features/projects/utils/projectHealth";
import { cn } from "@/shared/utils/cn";

const ROWS = 6;
const IN_SCOPE_LIMIT = 50;

/** Scored on the server's counts under the widget's filters, so "Me" grades only the viewer's work. */
export function ProjectHealthWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(
    widget.id,
    "status_by_project",
    widget.filters,
    IN_SCOPE_LIMIT,
  );
  const rows = (data?.statusByProject ?? []).map((row) => ({
    project: { id: row.projectId, name: data?.projects[row.projectId]?.name ?? "Project" },
    stats: row.health,
    health: computeHealth(row.health),
  }));
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
