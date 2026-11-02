import { Link } from "react-router-dom";
import { Flag } from "@phosphor-icons/react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useAppSelector } from "@/app/hooks";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget, SprintProgress } from "@/features/dashboard/types";
import { CHART_THEME, chartSeriesColors } from "@/config/theme/chartPalette";
import { formatDateShort } from "@/shared/utils/dateFormatting";

const ROWS = 4;
const [LINE] = chartSeriesColors(1);

function SprintRow({ sprint, chart }: { sprint: SprintProgress; chart: boolean }) {
  const project = useAppSelector((state) => state.projects.projects[sprint.projectId]);
  const percent = sprint.total > 0 ? Math.round((sprint.completed / sprint.total) * 100) : 0;
  const dates = [sprint.startDate, sprint.endDate].filter(Boolean).map(formatDateShort).join(" - ");

  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <Link
          to={`/projects/${sprint.projectId}`}
          className="min-w-0 truncate font-medium text-foreground hover:text-primary"
        >
          {sprint.name}
          {project && <span className="font-normal text-muted-foreground"> · {project.name}</span>}
        </Link>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {sprint.completed}/{sprint.total} · {percent}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${sprint.name} progress`}
      >
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: LINE }} />
      </div>
      {dates && <p className="text-[11px] text-subtle-foreground">{dates}</p>}
      {chart && sprint.burndown.length > 1 && (
        <div className="h-24" aria-label={`${sprint.name} burndown`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sprint.burndown} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="date"
                tick={CHART_THEME.tick}
                tickFormatter={formatDateShort}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <Tooltip
                {...CHART_THEME.tooltip}
                cursor={CHART_THEME.cursor}
                labelFormatter={(label) => formatDateShort(String(label))}
              />
              <Area
                type="stepAfter"
                dataKey="remaining"
                name="Remaining"
                stroke={LINE}
                fill={LINE}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </li>
  );
}

export function SprintProgressWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(
    widget.id,
    "sprint_progress",
    widget.filters,
    ROWS,
  );
  const sprints = data?.sprints ?? [];

  return (
    <MetricWidgetCard
      widget={widget}
      title="Sprint progress"
      icon={Flag}
      colSpan={2}
      loading={loading}
      failed={failed}
      count={sprints.length}
    >
      {sprints.length === 0 ? (
        <EmptyWidget
          icon={Flag}
          title="No running sprint"
          description="Start a sprint to track it here."
        />
      ) : (
        <ul className="space-y-4">
          {sprints.map((sprint, index) => (
            <SprintRow key={sprint.sprintId} sprint={sprint} chart={index === 0} />
          ))}
        </ul>
      )}
    </MetricWidgetCard>
  );
}
