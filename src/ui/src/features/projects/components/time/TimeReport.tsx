import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClockCountdown } from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { MentionChipCompact } from "@/components/mention";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { PaneHeader } from "@/components/ui/pane-header";
import { popoverShellClass } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey, formatDateWithWeekday } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import { selectTasksForProject } from "@/features/projects/store/projectsSlice";
import {
  selectProjectReport,
  selectReportLoading,
  selectTimePolicy,
} from "@/features/projects/store/timeSlice";
import { fetchProjectReport } from "@/features/projects/store/timeThunks";
import {
  reportKey,
  type AggregateGroupBy,
  type AggregateRow,
} from "@/features/projects/types/time";
import {
  CHART_ROW_LIMIT,
  GROUP_LABEL,
  PRESET_LABEL,
  axisLabel,
  chartRows,
  dayTick,
  hoursTick,
  presetRange,
  rangeIsValid,
  shareOf,
  type ReportPreset,
} from "@/features/projects/utils/timeReport";
import { normalizeWeekStart } from "@/features/projects/utils/timeWeek";

const PRESETS: ReportPreset[] = ["week", "month", "quarter"];
const GROUPS: AggregateGroupBy[] = ["user", "task", "day"];
const CHART_HEIGHT = 240;
const BAR_SIZE = 24;
const ROW_HEIGHT = 32;

interface TimeReportProps {
  projectId: string;
  /** The pane's title bar; the report adds its filter row underneath. */
  /** The page's header bar, given the report's controls to place beside the title. */
  renderHeader: (controls: ReactNode) => ReactNode;
}

const pill = (label: string) => (
  <span className="flex h-3.5 items-center px-1 text-xs">{label}</span>
);

/** Logged time in one project over a date range, grouped by person, task or day. */
export function TimeReport({ projectId, renderHeader }: TimeReportProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector(selectTimePolicy);
  const { weekStart: preferredWeekStart } = useAppearanceSettings();
  const weekStart = normalizeWeekStart(policy?.weekStart ?? preferredWeekStart);
  const today = effectiveDayKey(new Date());
  const [preset, setPreset] = useState<ReportPreset | null>("month");
  const [range, setRange] = useState(() => presetRange("month", today, weekStart));
  const [groupBy, setGroupBy] = useState<AggregateGroupBy>("user");
  const query = useMemo(
    () => ({ projectId, from: range.from, to: range.to, groupBy }),
    [projectId, range.from, range.to, groupBy],
  );
  const key = reportKey(query);
  const report = useAppSelector(selectProjectReport(key));
  const loading = useAppSelector(selectReportLoading(key));
  const selectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const tasks = useAppSelector(selectTasks);
  const valid = rangeIsValid(range.from, range.to);

  useEffect(() => {
    if (valid) void dispatch(fetchProjectReport(query));
  }, [dispatch, query, valid]);

  const estimates = useMemo(() => {
    const byTask: Record<string, number | null> = {};
    for (const task of tasks) byTask[task.id] = task.estimatedMinutes;
    return byTask;
  }, [tasks]);

  const rows = report?.rows ?? [];
  const total = report?.totalMinutes ?? 0;
  const entries = rows.reduce((sum, row) => sum + row.entries, 0);
  const busiest = rows.reduce<AggregateRow | null>(
    (top, row) => (top === null || row.minutes > top.minutes ? row : top),
    null,
  );
  const estimated =
    groupBy === "task" ? rows.reduce((sum, row) => sum + (estimates[row.key] ?? 0), 0) : null;

  const choosePreset = (next: ReportPreset) => {
    setPreset(next);
    setRange(presetRange(next, today, weekStart));
  };
  const chooseDate = (edge: "from" | "to", value: string) => {
    setPreset(null);
    setRange((previous) => ({ ...previous, [edge]: value }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="time-report">
      <PaneHeader>
        {renderHeader(
          <>
            <SegmentedControl
              ariaLabel="Date range"
              className="h-7"
              value={preset ?? "custom"}
              onChange={(value) => {
                if (value !== "custom") choosePreset(value);
              }}
              options={[
                ...PRESETS.map((value) => ({ value, content: pill(PRESET_LABEL[value]) })),
                ...(preset === null ? [{ value: "custom" as const, content: pill("Custom") }] : []),
              ]}
            />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span data-testid="report-from">
                <DatePicker
                  size="sm"
                  triggerClassName="h-7"
                  value={range.from}
                  onChange={(v) => chooseDate("from", v)}
                />
              </span>
              <span>to</span>
              <span data-testid="report-to">
                <DatePicker
                  size="sm"
                  triggerClassName="h-7"
                  value={range.to}
                  onChange={(v) => chooseDate("to", v)}
                />
              </span>
            </div>
            <div className="hidden h-5 w-px shrink-0 bg-border lg:block" aria-hidden />
            <SegmentedControl
              ariaLabel="Group by"
              className="h-7"
              value={groupBy}
              onChange={setGroupBy}
              options={GROUPS.map((value) => ({ value, content: pill(GROUP_LABEL[value]) }))}
            />
          </>,
        )}
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-4">
        {!valid ? (
          <p className="text-sm text-muted-foreground" data-testid="report-invalid">
            The start of the range must come before its end.
          </p>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Logged" value={formatMinutes(total)} testId="report-total" />
              <Stat label="Entries" value={String(entries)} />
              <Stat
                label={groupBy === "user" ? "People" : groupBy === "task" ? "Tasks" : "Days"}
                value={String(rows.length)}
              />
              {estimated !== null ? (
                <Stat label="Estimated" value={formatMinutes(estimated)} />
              ) : (
                <Stat label="Busiest" value={busiest ? labelOf(busiest, groupBy, false) : "–"} />
              )}
            </div>

            <Card tone="surface" className="px-2 pt-4 pb-2" data-testid="report-chart">
              {rows.length === 0 ? (
                <div
                  className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
                  data-testid="report-empty"
                >
                  <ClockCountdown size={24} className="text-subtle-foreground" />
                  {loading ? "Loading the report..." : "No time logged in this range."}
                </div>
              ) : (
                <ReportChart rows={rows} groupBy={groupBy} />
              )}
              {rows.length > CHART_ROW_LIMIT && (
                <p className="px-2 pt-1 text-xs text-subtle-foreground">
                  The chart shows the top {CHART_ROW_LIMIT}; the table below has every row.
                </p>
              )}
            </Card>

            <div className="overflow-x-auto">
              <Table tone="surface">
                <TableHeader>
                  <TableRow>
                    <TableHead>{GROUP_LABEL[groupBy]}</TableHead>
                    <TableHead className="w-24 text-right">Entries</TableHead>
                    <TableHead className="w-28 text-right">Logged</TableHead>
                    {groupBy === "task" && (
                      <TableHead className="hidden w-28 text-right md:table-cell">
                        Estimated
                      </TableHead>
                    )}
                    <TableHead className="hidden w-20 text-right md:table-cell">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableEmpty
                      colSpan={groupBy === "task" ? 5 : 4}
                      title={loading ? "Loading..." : "Nothing logged"}
                      description="Entries in this range will appear here."
                    />
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.key} data-testid="report-row">
                        <TableCell className="py-1.5">
                          {groupBy === "day" && formatDateWithWeekday(row.key)}
                          {groupBy === "user" && (
                            <MentionChipCompact
                              urn={userUrn(row.key)}
                              label={row.label || "Member"}
                            />
                          )}
                          {groupBy === "task" && (
                            <Link
                              to={`/projects/${projectId}/tasks/${row.key}`}
                              className="text-foreground hover:underline"
                            >
                              {row.label || "Task"}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                          {formatMinutes(row.minutes)}
                        </TableCell>
                        {groupBy === "task" && (
                          <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                            {estimates[row.key] ? formatMinutes(estimates[row.key] ?? 0) : "–"}
                          </TableCell>
                        )}
                        <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                          {shareOf(row.minutes, total)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function userUrn(userId: string): string {
  return `urn:uniffy:content:USER:${userId}`;
}

function labelOf(row: AggregateRow, groupBy: AggregateGroupBy, short: boolean): string {
  if (groupBy === "day") return short ? dayTick(row.key) : formatDateWithWeekday(row.key);
  const label = row.label || GROUP_LABEL[groupBy];
  return short ? axisLabel(label) : label;
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Card tone="surface" className="px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </Card>
  );
}

interface ChartDatum {
  name: string;
  full: string;
  minutes: number;
  /** The axis runs in hours so its ticks land on clean numbers. */
  hours: number;
}

function ReportChart({ rows, groupBy }: { rows: AggregateRow[]; groupBy: AggregateGroupBy }) {
  const data: ChartDatum[] = chartRows(rows, groupBy).map((row) => ({
    name: labelOf(row, groupBy, true),
    full: labelOf(row, groupBy, false),
    minutes: row.minutes,
    hours: row.minutes / 60,
  }));
  const formatHours = (hours: number) => hoursTick(Math.round(hours * 60));
  const tick = { fontSize: 11, fill: "var(--color-muted-foreground)" };
  const grid = "var(--color-border)";
  const cursor = { fill: "var(--color-foreground)", fillOpacity: 0.05 };

  if (groupBy === "day") {
    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} interval={0} />
          <YAxis
            tickFormatter={formatHours}
            tick={tick}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <RechartsTooltip content={<ChartTooltip />} cursor={cursor} />
          <Bar
            dataKey="hours"
            fill="var(--color-primary)"
            maxBarSize={BAR_SIZE}
            radius={[4, 4, 0, 0]}
            animationDuration={400}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * ROW_HEIGHT + 24, 120)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        barCategoryGap="25%"
      >
        <CartesianGrid stroke={grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={formatHours}
          tick={tick}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={tick}
          axisLine={false}
          tickLine={false}
          width={150}
          interval={0}
        />
        <RechartsTooltip content={<ChartTooltip />} cursor={cursor} />
        <Bar
          dataKey="hours"
          fill="var(--color-primary)"
          maxBarSize={BAR_SIZE}
          radius={[0, 4, 4, 0]}
          animationDuration={400}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartDatum }[];
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <div className={cn(popoverShellClass, "px-3 py-2 text-xs")}>
      <p className="font-medium text-foreground">{formatMinutes(datum.minutes)}</p>
      <p className="text-muted-foreground">{datum.full}</p>
    </div>
  );
}
