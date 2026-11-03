import { Bug } from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget } from "@/features/dashboard/types";
import { CHART_THEME, chartSeriesColors } from "@/config/theme/chartPalette";
import { formatDateShort } from "@/shared/utils/dateFormatting";

const [OPENED, CLOSED] = chartSeriesColors(2);

export function BugTrendWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(widget.id, "bug_trend", widget.filters);
  const days = data?.bugTrend ?? [];
  const opened = days.reduce((sum, day) => sum + day.opened, 0);
  const closed = days.reduce((sum, day) => sum + day.closed, 0);

  return (
    <MetricWidgetCard
      widget={widget}
      title="Bugs opened vs closed"
      icon={Bug}
      colSpan={2}
      loading={loading}
      failed={failed}
      skeleton="stat"
    >
      <div className="mb-2 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: OPENED }} />
          Opened <span className="font-semibold tabular-nums text-foreground">{opened}</span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: CLOSED }} />
          Closed <span className="font-semibold tabular-nums text-foreground">{closed}</span>
        </span>
        <span className="ml-auto text-subtle-foreground">Last {days.length} days</span>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={CHART_THEME.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={CHART_THEME.tick}
              tickFormatter={formatDateShort}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={CHART_THEME.tick}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              {...CHART_THEME.tooltip}
              cursor={CHART_THEME.cursor}
              labelFormatter={(label) => formatDateShort(String(label))}
            />
            <Area
              type="monotone"
              dataKey="opened"
              name="Opened"
              stroke={OPENED}
              fill={OPENED}
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="closed"
              name="Closed"
              stroke={CLOSED}
              fill={CLOSED}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </MetricWidgetCard>
  );
}
