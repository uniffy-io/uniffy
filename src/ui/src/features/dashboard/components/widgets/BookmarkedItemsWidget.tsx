/**
 * BookmarkedItemsWidget - Quick access to bookmarked content
 *
 * Groups bookmarks by URN type with color-coded badges.
 * Max 6 items shown with "View all bookmarks" footer.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookmarkSimple, ArrowRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { parseUrn, urnToPath } from '@/shared/utils/urn';
import { UrnType } from '@/shared/utils/urnTypes';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import type { SerializedBookmark } from '@/features/bookmarks/store/bookmarksSlice';

interface BookmarkedItem {
  urn: string;
  type: UrnType;
  title: string;
  href: string;
  createdAt: string;
}

function BookmarkListItem({ item }: { item: BookmarkedItem }) {
  const config = getContentTypeConfig(item.type);
  const Icon = config.icon;

  return (
    <Link
      to={item.href}
      className={cn(
        'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
        'hover:bg-muted/50',
      )}
    >
      <div className={cn('rounded-md p-1.5', config.theme.badgeBg)}>
        <Icon size={16} weight="duotone" className={config.theme.accentText} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {item.title}
        </p>
      </div>
      <span
        className={cn(
          'text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0',
          config.theme.badgeBg,
          config.theme.accentText,
        )}
      >
        {config.label}
      </span>
    </Link>
  );
}

export function BookmarkedItemsWidget() {
  const bookmarks = useAppSelector((state) => state.bookmarks?.bookmarks ?? {});
  const isLoading = useAppSelector((state) => state.bookmarks?.loading ?? false);

  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const files = useAppSelector((state) => state.files?.files ?? {});
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const tasks = useAppSelector((state) => state.projects?.tasks ?? {});
  const projects = useAppSelector((state) => state.projects?.projects ?? {});

  const bookmarkedItems = useMemo(() => {
    const items: BookmarkedItem[] = [];

    Object.values(bookmarks).forEach((bookmark: SerializedBookmark) => {
      const parsed = parseUrn(bookmark.urn);
      if (!parsed) return;

      let title = 'Unknown';
      let href = '/';

      switch (parsed.type) {
        case UrnType.NOTE: {
          const note = notes[parsed.id];
          title = note?.title || 'Untitled Note';
          href = `/notes/${parsed.id}`;
          break;
        }
        case UrnType.FILE: {
          const file = files[parsed.id];
          title = file?.filename || 'Unknown File';
          href = `/files?file=${parsed.id}`;
          break;
        }
        case UrnType.CALENDAR_EVENT: {
          const event = events[parsed.id];
          title = event?.title || 'Unknown Event';
          href = `/calendar?event=${parsed.id}`;
          break;
        }
        case UrnType.TASK: {
          const task = tasks[parsed.id];
          title = task?.title || 'Unknown Task';
          href = task ? `/projects/${task.projectId}?task=${parsed.id}` : '/projects';
          break;
        }
        case UrnType.PROJECT: {
          const project = projects[parsed.id];
          title = project?.name || 'Unknown Project';
          href = `/projects/${parsed.id}`;
          break;
        }
        default:
          href = urnToPath(bookmark.urn) || '/';
      }

      items.push({
        urn: bookmark.urn,
        type: parsed.type,
        title,
        href,
        createdAt: bookmark.createdAt,
      });
    });

    return items
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [bookmarks, notes, files, events, tasks, projects]);

  const isEmpty = bookmarkedItems.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Bookmarked"
      icon={BookmarkSimple}
      colSpan={2}
      priority={2}
      footer={
        bookmarkedItems.length > 0 ? (
          <Link
            to="/search?q=bookmarked:true"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all bookmarks
            <ArrowRight size={12} />
          </Link>
        ) : null
      }
    >
      {isLoading && Object.keys(bookmarks).length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={BookmarkSimple}
          title="No bookmarks yet"
          description="Pin important items for quick access"
        />
      ) : (
        <div className="space-y-0.5">
          {bookmarkedItems.map((item) => (
            <BookmarkListItem key={item.urn} item={item} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
