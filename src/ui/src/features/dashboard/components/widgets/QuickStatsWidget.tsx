/**
 * QuickStatsWidget - Horizontal row of compact stat cards
 *
 * Shows: unread notifications, tasks due today, events today, team online.
 * Clickable cards navigate to relevant pages.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Target, CalendarDots, Users, ArrowRight } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Task } from '@/features/projects/types/project';

interface StatCardProps {
  icon: Icon;
  label: string;
  value: number;
  href: string;
  iconColor: string;
  loading?: boolean;
}

function StatCard({ icon: IconComponent, label, value, href, iconColor, loading }: StatCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-all duration-200',
        'hover:border-primary/30 hover:shadow-md',
      )}
    >
      <div className={cn('rounded-lg p-2', iconColor)}>
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
    </Link>
  );
}

export function QuickStatsWidget() {
  const unreadCount = useAppSelector((state) => state.notifications?.unreadCount ?? 0);
  const notificationsLoading = useAppSelector((state) => state.notifications?.loading ?? false);

  const tasks = useAppSelector((state) => state.projects?.tasks ?? {});
  const tasksLoading = useAppSelector((state) => state.projects?.loading?.tasks ?? false);
  const userId = useAppSelector((state) => state.auth.user?.id ?? '');

  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const presenceStatuses = useAppSelector((state) => state.presence?.statuses ?? {});

  const tasksDueToday = useMemo(() => {
    const now = new Date();
    return Object.values(tasks).filter((task: Task) => {
      if (task.deletedAt || task.completedAt) return false;
      if (!task.assigneeIds.includes(userId)) return false;
      if (!task.dueDate) return false;
      const due = new Date(task.dueDate);
      return (
        due.getFullYear() === now.getFullYear() &&
        due.getMonth() === now.getMonth() &&
        due.getDate() === now.getDate()
      );
    }).length;
  }, [tasks, userId]);

  const eventsToday = useMemo(() => {
    const now = new Date();
    return Object.values(events).filter((event: CalendarEvent) => {
      const start = new Date(event.startTime);
      return (
        start.getFullYear() === now.getFullYear() &&
        start.getMonth() === now.getMonth() &&
        start.getDate() === now.getDate()
      );
    }).length;
  }, [events]);

  const teamOnline = useMemo(() => {
    return Object.values(presenceStatuses).filter(
      (status) => status === 'online' || status === 'away' || status === 'dnd',
    ).length;
  }, [presenceStatuses]);

  const stats: StatCardProps[] = [
    {
      icon: Bell,
      label: 'Unread',
      value: unreadCount,
      href: '/notifications',
      iconColor: 'bg-gradient-to-br from-amber-500 to-amber-600',
      loading: notificationsLoading,
    },
    {
      icon: Target,
      label: 'Tasks due',
      value: tasksDueToday,
      href: '/projects',
      iconColor: 'bg-gradient-to-br from-teal-500 to-teal-600',
      loading: tasksLoading,
    },
    {
      icon: CalendarDots,
      label: 'Events today',
      value: eventsToday,
      href: '/calendar',
      iconColor: 'bg-gradient-to-br from-rose-500 to-rose-600',
      loading: eventsLoading,
    },
    {
      icon: Users,
      label: 'Team online',
      value: teamOnline,
      href: '/chat',
      iconColor: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      loading: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
