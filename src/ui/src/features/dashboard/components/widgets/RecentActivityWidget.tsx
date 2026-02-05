/**
 * RecentActivityWidget - Unified activity feed across all domains
 *
 * Aggregates recently updated items from notes, files, and calendar events,
 * sorted by last modified date.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { UrnType } from '@/shared/utils/urnTypes';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';

interface ActivityItem {
  id: string;
  title: string;
  type: UrnType;
  updatedAt: string;
  href: string;
}

/** Convert protobuf timestamp to ISO string */
function timestampToString(ts: { seconds: number; nanos: number } | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000).toISOString();
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ActivityListItem({ item }: { item: ActivityItem }) {
  const config = getContentTypeConfig(item.type);
  const Icon = config.icon;

  return (
    <Link
      to={item.href}
      className={cn(
        'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
        'hover:bg-muted/50'
      )}
    >
      <div className={cn('rounded-md p-1.5', config.theme.badgeBg)}>
        <Icon size={16} weight="duotone" className={config.theme.accentText} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {item.title || 'Untitled'}
        </p>
        <p className="text-xs text-muted-foreground">
          {config.label}
        </p>
      </div>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {formatRelativeTime(item.updatedAt)}
      </span>
    </Link>
  );
}

export function RecentActivityWidget() {
  // Get data from all domains
  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const notesLoading = useAppSelector((state) => state.notes?.loading ?? false);

  const files = useAppSelector((state) => state.files?.files ?? {});
  const filesLoading = useAppSelector((state) => state.files?.loading ?? false);

  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const isLoading = notesLoading || filesLoading || eventsLoading;

  // Merge and sort all items by updatedAt
  const recentItems = useMemo(() => {
    const items: ActivityItem[] = [];

    // Add notes
    Object.values(notes).forEach((note) => {
      if (!note.isDeleted) {
        items.push({
          id: note.id,
          title: note.title,
          type: UrnType.NOTE,
          updatedAt: timestampToString(note.updatedAt),
          href: `/notes/${note.id}`,
        });
      }
    });

    // Add files (folders are not in the files store, only actual files)
    Object.values(files).forEach((file) => {
      if (!file.isDeleted) {
        items.push({
          id: file.id,
          title: file.filename,
          type: UrnType.FILE,
          updatedAt: timestampToString(file.updatedAt),
          href: `/files?file=${file.id}`,
        });
      }
    });

    // Add events (only past/recent events, not future ones)
    const now = new Date();
    Object.values(events).forEach((event) => {
      const eventDate = new Date(event.updatedAt);
      // Include events updated in the last 7 days
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (eventDate >= weekAgo) {
        items.push({
          id: event.id,
          title: event.title,
          type: UrnType.CALENDAR_EVENT,
          updatedAt: event.updatedAt,
          href: `/calendar?event=${event.id}`,
        });
      }
    });

    // Sort by updatedAt descending and take top 8
    return items
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8);
  }, [notes, files, events]);

  const isEmpty = recentItems.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Recent Activity"
      subtitle="Your recent updates across the workspace"
      colSpan={3}
    >
      {isLoading && Object.keys(notes).length === 0 ? (
        <WidgetSkeleton rows={5} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={ClockCounterClockwise}
          title="No recent activity"
          description="Your recent notes, files, and events will appear here"
        />
      ) : (
        <div className="space-y-1">
          {recentItems.map((item) => (
            <ActivityListItem key={`${item.type}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
