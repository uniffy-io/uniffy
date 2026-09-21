import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Target, CalendarDots, Users, ArrowRight } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import type { CalendarEvent } from "@/features/calendar/types";
import { useMyTasks } from "@/features/dashboard/hooks/useMyTasks";
import { MyTasksDialog } from "@/features/dashboard/components/MyTasksDialog";

interface StatCardProps {
  icon: Icon;
  label: string;
  value: number;
  /** Either a route to open or an in-page action. */
  target: { href: string } | { onSelect: () => void };
  iconColor: string;
  loading?: boolean;
}

const STAT_CARD_CLASS = cn(
  "group relative flex items-center gap-3 rounded-xl bg-surface p-3.5 shadow-edge transition-shadow duration-200",
  "hover:shadow-edge-primary text-left w-full",
);

function StatCard({
  icon: IconComponent,
  label,
  value,
  target,
  iconColor,
  loading,
}: StatCardProps) {
  const body = (
    <>
      <div className={cn("rounded-lg p-2", iconColor)}>
        <IconComponent size={18} weight="fill" className="text-white" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <div className="h-6 w-8 rounded bg-muted animate-pulse" />
        ) : (
          <p className="text-xl font-bold leading-none">{value.toLocaleString()}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
      <ArrowRight
        size={14}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-all duration-200 group-hover:opacity-100"
      />
    </>
  );

  if ("href" in target) {
    return (
      <Link to={target.href} className={STAT_CARD_CLASS}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={target.onSelect} className={cn(STAT_CARD_CLASS, "focus-ring")}>
      {body}
    </button>
  );
}

export function QuickStatsWidget() {
  const unreadCount = useAppSelector((state) => state.notifications?.unreadCount ?? 0);
  const notificationsLoading = useAppSelector((state) => state.notifications?.loading ?? false);

  const tasksLoading = useAppSelector((state) => state.projects?.loading?.tasks ?? false);
  const { dueToday } = useMyTasks();
  const [isDueTodayOpen, setIsDueTodayOpen] = useState(false);

  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const presenceStatuses = useAppSelector((state) => state.presence?.statuses ?? {});

  const eventsToday = useMemo(() => {
    const todayKey = effectiveDayKey(new Date());
    return Object.values(events).filter(
      (event: CalendarEvent) => effectiveDayKey(new Date(event.startTime)) === todayKey,
    ).length;
  }, [events]);

  const teamOnline = useMemo(() => {
    return Object.values(presenceStatuses).filter(
      (status) => status === "online" || status === "away" || status === "dnd",
    ).length;
  }, [presenceStatuses]);

  const stats: StatCardProps[] = [
    {
      icon: Bell,
      label: "Unread",
      value: unreadCount,
      target: { href: "/notifications" },
      iconColor: "bg-gradient-to-br from-amber-500 to-amber-600",
      loading: notificationsLoading,
    },
    {
      icon: Target,
      label: "Tasks due",
      value: dueToday.length,
      target: { onSelect: () => setIsDueTodayOpen(true) },
      iconColor: "bg-gradient-to-br from-teal-500 to-teal-600",
      loading: tasksLoading,
    },
    {
      icon: CalendarDots,
      label: "Events today",
      value: eventsToday,
      target: { href: "/calendar" },
      iconColor: "bg-gradient-to-br from-rose-500 to-rose-600",
      loading: eventsLoading,
    },
    {
      icon: Users,
      label: "Team online",
      value: teamOnline,
      target: { href: "/chat" },
      iconColor: "bg-gradient-to-br from-emerald-500 to-emerald-600",
      loading: false,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
      {isDueTodayOpen && (
        <MyTasksDialog initialView="dueToday" onClose={() => setIsDueTodayOpen(false)} />
      )}
    </>
  );
}
