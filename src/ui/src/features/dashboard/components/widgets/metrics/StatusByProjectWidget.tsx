import { Link } from "react-router-dom";
import { ChartBar } from "@phosphor-icons/react";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget, ProjectStatusCounts } from "@/features/dashboard/types";
import { chartSeriesColors } from "@/config/theme/chartPalette";

const ROWS = 6;
const SEGMENTS = [
  { key: "todo", label: "To do" },
  { key: "inProgress", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "completed", label: "Done" },
] as const satisfies readonly { key: keyof ProjectStatusCounts; label: string }[];
const COLORS = chartSeriesColors(SEGMENTS.length);

export function StatusByProjectWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(
    widget.id,
    "status_by_project",
    widget.filters,
    ROWS,
  );
  const rows = data?.statusByProject ?? [];

  return (
    <MetricWidgetCard
      widget={widget}
      title="Tasks by status"
      icon={ChartBar}
      colSpan={2}
      loading={loading}
      failed={failed}
    >
      {rows.length === 0 ? (
        <EmptyWidget
          icon={ChartBar}
          title="No tasks yet"
          description="Projects here have no tasks."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {SEGMENTS.map((segment, index) => (
              <span key={segment.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: COLORS[index] }} />
                {segment.label}
              </span>
            ))}
          </div>
          <ul className="space-y-2.5">
            {rows.map((row) => {
              const total = SEGMENTS.reduce((sum, segment) => sum + row[segment.key], 0);
              const project = data?.projects[row.projectId];
              return (
                <li key={row.projectId}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <Link
                      to={`/projects/${row.projectId}`}
                      className="truncate font-medium text-foreground hover:text-primary"
                    >
                      {project?.name ?? "Project"}
                    </Link>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {row.completed}/{total} done
                    </span>
                  </div>
                  <div
                    className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={SEGMENTS.map((s) => `${row[s.key]} ${s.label.toLowerCase()}`).join(
                      ", ",
                    )}
                  >
                    {SEGMENTS.map((segment, index) =>
                      row[segment.key] > 0 ? (
                        <div
                          key={segment.key}
                          title={`${segment.label}: ${row[segment.key]}`}
                          style={{
                            width: `${(row[segment.key] / Math.max(1, total)) * 100}%`,
                            background: COLORS[index],
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </MetricWidgetCard>
  );
}
