import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { WidgetCard } from "@/features/dashboard/components/widgets/WidgetCard";
import {
  useAppearanceSettings,
  useSchedulingSettings,
} from "@/features/settings/hooks/useSettings";
import {
  selectTimePolicy,
  selectWeekDays,
  selectWeekLoading,
  selectWeekWorklogs,
} from "@/features/projects/store/timeSlice";
import { fetchTimePolicy, fetchUserWorklogs } from "@/features/projects/store/timeThunks";
import {
  dayStatus,
  normalizeWeekStart,
  requirementsFor,
  weekDays,
  weekRangeKey,
  weekStartOf,
} from "@/features/projects/utils/timeWeek";

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

/** This week's logged time against what the policy requires, one bar per day. */
export function MyTimeWidget() {
  const dispatch = useAppDispatch();
  const policy = useAppSelector(selectTimePolicy);
  const { workdays } = useSchedulingSettings();
  const { weekStart: preferredWeekStart } = useAppearanceSettings();
  const weekStart = normalizeWeekStart(policy?.weekStart ?? preferredWeekStart);
  const today = effectiveDayKey(new Date());
  const days = useMemo(() => weekDays(weekStartOf(today, weekStart)), [today, weekStart]);
  const rangeKey = weekRangeKey(days[0], days[6]);
  const selectWorklogs = useMemo(() => selectWeekWorklogs(rangeKey), [rangeKey]);
  const worklogs = useAppSelector(selectWorklogs);
  const servedDays = useAppSelector(selectWeekDays(rangeKey));
  const loading = useAppSelector(selectWeekLoading(rangeKey));
  const enabled = policy?.enabled ?? false;

  useEffect(() => {
    if (!policy) void dispatch(fetchTimePolicy());
  }, [dispatch, policy]);

  useEffect(() => {
    if (enabled) void dispatch(fetchUserWorklogs({ from: days[0], to: days[6] }));
  }, [dispatch, enabled, days]);

  const bars = useMemo(() => {
    const rule = {
      requiredMinutesPerDay: policy?.requiredMinutesPerDay ?? 0,
      workdays,
      holidays: policy?.holidays ?? [],
    };
    const requirements = requirementsFor(days, servedDays, rule);
    return days.map((day) => {
      const total = worklogs
        .filter((entry) => entry.workDate === day)
        .reduce((sum, entry) => sum + entry.durationMinutes, 0);
      const required = requirements[day].required;
      return { day, total, required, status: dayStatus(total, required) };
    });
  }, [days, worklogs, servedDays, workdays, policy]);

  if (!policy || !policy.enabled) return null;

  const total = bars.reduce((sum, bar) => sum + bar.total, 0);
  const required = bars.reduce((sum, bar) => sum + bar.required, 0);
  const scale = Math.max(1, ...bars.map((bar) => Math.max(bar.total, bar.required)));

  return (
    <WidgetCard
      title="My time"
      subtitle="This week"
      icon={Clock}
      compact
      loading={loading && worklogs.length === 0}
      action={
        <Link
          to="/projects/time"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid="my-time-widget-open"
        >
          Open <ArrowRight size={12} />
        </Link>
      }
    >
      <div className="flex items-end justify-between gap-3" data-testid="my-time-widget">
        <div>
          <p className="text-xl font-bold leading-none tabular-nums">{formatMinutes(total)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {required > 0 ? `of ${formatMinutes(required)} required` : "logged"}
          </p>
        </div>
        <div className="flex h-12 items-end gap-1" aria-hidden>
          {bars.map((bar) => (
            <div key={bar.day} className="flex w-4 flex-col items-center gap-0.5">
              <div className="flex h-9 w-full items-end rounded-sm bg-muted/60">
                <div
                  className={cn("w-full rounded-sm", bar.total === 0 && "bg-transparent")}
                  style={{
                    height: `${Math.round((bar.total / scale) * 100)}%`,
                    backgroundColor:
                      bar.status === "under"
                        ? STATUS_HEX_COLORS.warning
                        : bar.status === "none"
                          ? undefined
                          : STATUS_HEX_COLORS.success,
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-[9px] leading-none",
                  bar.day === today ? "text-primary" : "text-subtle-foreground",
                )}
              >
                {WEEKDAY_LETTER[new Date(`${bar.day}T00:00:00Z`).getUTCDay()]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}
