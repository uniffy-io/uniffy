/**
 * QuickStatsWidget - Displays key metrics across all content domains
 *
 * Shows counts for:
 * - Notes
 * - Files
 * - Upcoming events (this week)
 * - Bookmarks
 */

import { Link } from 'react-router-dom';
import type { Icon } from '@phosphor-icons/react';
import { ArrowRight, BookmarkSimple } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { UrnType } from '@/shared/utils/urnTypes';

interface StatCardProps {
  icon: Icon;
  label: string;
  value: number;
  href: string;
  theme: {
    iconBg: string;
    accentText: string;
  };
  loading?: boolean;
}

function StatCard({ icon: IconComponent, label, value, href, theme, loading }: StatCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        'group relative rounded-xl border border-border bg-card p-4 transition-all duration-200',
        'hover:border-primary/30 hover:shadow-md'
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn('rounded-lg p-2', theme.iconBg)}>
          <IconComponent size={20} weight="fill" className="text-white" />
        </div>
        <ArrowRight
          size={16}
          className="text-muted-foreground opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5"
        />
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="h-7 w-12 rounded bg-muted animate-pulse" />
        ) : (
          <p className={cn('text-2xl font-bold', theme.accentText)}>{value.toLocaleString()}</p>
        )}
        <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
      </div>
    </Link>
  );
}

export function QuickStatsWidget() {
  // Get data from all domain slices
  const notesCount = useAppSelector((state) => state.notes?.pagination?.totalCount ?? 0);
  const notesLoading = useAppSelector((state) => state.notes?.loading ?? false);

  const filesCount = useAppSelector((state) => state.files?.pagination?.totalCount ?? 0);
  const filesLoading = useAppSelector((state) => state.files?.loading ?? false);

  const bookmarksCount = useAppSelector((state) => state.bookmarks?.totalCount ?? 0);
  const bookmarksLoading = useAppSelector((state) => state.bookmarks?.loading ?? false);

  // Calculate upcoming events count (events in the next 7 days)
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const upcomingEventsCount = Object.values(events).filter((event) => {
    const eventDate = new Date(event.startTime);
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return eventDate >= now && eventDate <= weekFromNow;
  }).length;

  const noteConfig = getContentTypeConfig(UrnType.NOTE);
  const fileConfig = getContentTypeConfig(UrnType.FILE);
  const calendarConfig = getContentTypeConfig(UrnType.CALENDAR_EVENT);

  const stats = [
    {
      icon: noteConfig.icon,
      label: noteConfig.labelPlural,
      value: notesCount,
      href: '/notes',
      theme: noteConfig.theme,
      loading: notesLoading,
    },
    {
      icon: fileConfig.icon,
      label: fileConfig.labelPlural,
      value: filesCount,
      href: '/files',
      theme: fileConfig.theme,
      loading: filesLoading,
    },
    {
      icon: calendarConfig.icon,
      label: 'This Week',
      value: upcomingEventsCount,
      href: '/calendar',
      theme: calendarConfig.theme,
      loading: eventsLoading,
    },
    {
      icon: BookmarkSimple,
      label: 'Bookmarks',
      value: bookmarksCount,
      href: '/notes',
      theme: {
        iconBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
        accentText: 'text-amber-600 dark:text-amber-400',
      },
      loading: bookmarksLoading,
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
