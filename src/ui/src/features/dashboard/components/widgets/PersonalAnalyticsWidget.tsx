import { useMemo } from 'react';
import { ChartLine } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { WidgetCard, EmptyWidget } from '@/features/dashboard/components/widgets/WidgetCard';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis } from 'recharts';
import type { Task } from '@/features/projects/types/project';

function getDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isInDateRange(ts: { seconds: number; nanos: number } | undefined, dayStart: Date, dayEnd: Date): boolean {
  if (!ts) return false;
  const d = ts.seconds * 1000;
  return d >= dayStart.getTime() && d < dayEnd.getTime();
}

function isIsoInDateRange(iso: string | undefined | null, dayStart: Date, dayEnd: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  return d >= dayStart.getTime() && d < dayEnd.getTime();
}

export function PersonalAnalyticsWidget() {
  const { isMobile } = useBreakpoint();

  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const files = useAppSelector((state) => state.files?.files ?? {});
  const tasks = useAppSelector((state) => state.projects?.tasks ?? {});
  const userId = useAppSelector((state) => state.auth.user?.id ?? '');

  const { chartData, weekSummary } = useMemo(() => {
    const now = new Date();
    const days = 14;
    const data: { name: string; activity: number }[] = [];
    let weekNotes = 0;
    let weekTasks = 0;

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const isThisWeek = i < 7;
      let count = 0;

      Object.values(notes).forEach((n) => {
        if (!n.isDeleted && isInDateRange(n.updatedAt, dayStart, dayEnd)) {
          count++;
          if (isThisWeek) weekNotes++;
        }
      });

      Object.values(files).forEach((f) => {
        if (!f.isDeleted && isInDateRange(f.updatedAt, dayStart, dayEnd)) {
          count++;
        }
      });

      Object.values(tasks).forEach((t: Task) => {
        if (t.assigneeIds.includes(userId) && isIsoInDateRange(t.updatedAt, dayStart, dayEnd)) {
          count++;
          if (t.completedAt && isIsoInDateRange(t.completedAt, dayStart, dayEnd) && isThisWeek) {
            weekTasks++;
          }
        }
      });

      data.push({
        name: getDayLabel(dayStart),
        activity: count,
      });
    }

    return {
      chartData: data,
      weekSummary: { notes: weekNotes, tasks: weekTasks },
    };
  }, [notes, files, tasks, userId]);

  const hasActivity = chartData.some((d) => d.activity > 0);

  if (isMobile) return null;

  return (
    <WidgetCard
      title="Your Activity"
      icon={ChartLine}
      colSpan={2}
      priority={3}
      subtitle="Last 14 days"
    >
      {!hasActivity ? (
        <EmptyWidget
          icon={ChartLine}
          title="No activity yet"
          description="Your activity chart will appear here as you use the workspace"
        />
      ) : (
        <div className="space-y-3">
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                    padding: '6px 10px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                  itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  formatter={(value) => [value as number, 'Items']}
                />
                <Area
                  type="monotone"
                  dataKey="activity"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#activityGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {(weekSummary.tasks > 0 || weekSummary.notes > 0) && (
            <p className="text-xs text-muted-foreground text-center">
              {weekSummary.tasks > 0 && `${weekSummary.tasks} task${weekSummary.tasks !== 1 ? 's' : ''} completed`}
              {weekSummary.tasks > 0 && weekSummary.notes > 0 && ' and '}
              {weekSummary.notes > 0 && `${weekSummary.notes} note${weekSummary.notes !== 1 ? 's' : ''} edited`}
              {' this week'}
            </p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
