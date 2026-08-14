import { useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { setAnalyticsTimeRange } from "@/features/notifications/store/notificationsPageSlice";

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

const TYPE_LABELS: Record<number, string> = {
  [NotificationType.CONTENT_SHARED]: "Shared",
  [NotificationType.CONTENT_MENTIONED]: "Mentioned",
  [NotificationType.CONTENT_EDITED]: "Edited",
  [NotificationType.CALENDAR_REMINDER]: "Reminder",
  [NotificationType.CALENDAR_INVITE]: "Invite",
  [NotificationType.CALENDAR_RESPONSE]: "Response",
  [NotificationType.PERMISSION_GRANTED]: "Access granted",
  [NotificationType.PERMISSION_REVOKED]: "Access revoked",
  [NotificationType.SYSTEM_ANNOUNCEMENT]: "System",
  [NotificationType.TASK_ASSIGNED]: "Assigned",
  [NotificationType.TASK_DUE_SOON]: "Due soon",
  [NotificationType.TASK_OVERDUE]: "Overdue",
  [NotificationType.CHAT_MENTION]: "Chat mention",
  [NotificationType.CHAT_DM]: "DM",
  [NotificationType.CHAT_CHANNEL_INVITE]: "Channel invite",
  [NotificationType.CHAT_CHANNEL_REMOVED]: "Removed",
  [NotificationType.CHAT_THREAD_REPLY]: "Thread reply",
};

const CHART_COLORS = {
  total: "#6366f1",
  unread: "#f43f5e",
  read: "#10b981",
};

export function NotificationsAnalytics() {
  const dispatch = useAppDispatch();
  const stats = useAppSelector((s) => s.notificationsPage.stats);
  const statsLoading = useAppSelector((s) => s.notificationsPage.statsLoading);
  const analyticsTimeRange = useAppSelector((s) => s.notificationsPage.analyticsTimeRange);

  const handleTimeRangeChange = useCallback(
    (days: number) => {
      dispatch(setAnalyticsTimeRange(days));
    },
    [dispatch],
  );

  if (statsLoading && !stats) {
    return (
      <div className="border-b border-border px-4 md:px-6 py-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-32" />
          <div className="h-32 bg-muted/50 rounded" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const dailyData = stats.dailyStats.map((s) => ({
    date: s.date.slice(5),
    total: s.total,
    unread: s.unread,
    read: s.read,
  }));

  const typeData = stats.typeStats.slice(0, 8).map((s) => ({
    name: TYPE_LABELS[s.notificationType] ?? "Other",
    count: s.count,
  }));

  return (
    <div className="border-b border-border px-3 md:px-4 lg:px-6 py-3 md:py-4 bg-card/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Analytics
        </h3>
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => handleTimeRangeChange(range.days)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                analyticsTimeRange === range.days
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground mb-2">
            Notifications over time
          </p>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="read"
                  stackId="1"
                  stroke={CHART_COLORS.read}
                  fill={CHART_COLORS.read}
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="unread"
                  stackId="1"
                  stroke={CHART_COLORS.unread}
                  fill={CHART_COLORS.unread}
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {typeData.length > 0 && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-2">By type</p>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={80}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill={CHART_COLORS.total}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border/50">
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">{stats.totalCount}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold" style={{ color: CHART_COLORS.unread }}>
            {stats.unreadCount}
          </p>
          <p className="text-[10px] text-muted-foreground">Unread</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold" style={{ color: CHART_COLORS.read }}>
            {stats.readCount}
          </p>
          <p className="text-[10px] text-muted-foreground">Read</p>
        </div>
      </div>
    </div>
  );
}
