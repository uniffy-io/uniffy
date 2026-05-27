import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { urnToPath } from '@/shared/utils/urn';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';

function NotificationItem({ notification }: { notification: SerializedNotification }) {
  const path = notification.sourceUrn ? (urnToPath(notification.sourceUrn) ?? '/notifications') : '/notifications';

  return (
    <Link
      to={path}
      className={cn(
        'group flex items-start gap-2.5 rounded-lg p-2 -mx-2 transition-colors',
        'hover:bg-muted/50',
      )}
    >
      {notification.actorAvatarUrl ? (
        <img
          src={notification.actorAvatarUrl}
          alt=""
          className="w-6 h-6 rounded-full shrink-0 mt-0.5"
        />
      ) : (
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bell size={12} className="text-primary" weight="fill" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {notification.title}
        </p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
          {notification.actorName && `${notification.actorName} - `}
          {formatRelativeTime(notification.createdAt)}
        </p>
      </div>
    </Link>
  );
}

export function NotificationsSummaryWidget() {
  const notifications = useAppSelector((state) => state.notifications?.notifications ?? []);
  const unreadCount = useAppSelector((state) => state.notifications?.unreadCount ?? 0);
  const isLoading = useAppSelector((state) => state.notifications?.loading ?? false);

  const unreadNotifications = useMemo(() => {
    return notifications
      .filter((n: SerializedNotification) => !n.isRead)
      .slice(0, 3);
  }, [notifications]);

  const isEmpty = unreadCount === 0 && !isLoading;

  return (
    <WidgetCard
      title="Notifications"
      icon={Bell}
      colSpan={1}
      compact
      priority={2}
      action={
        unreadCount > 0 ? (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null
      }
      footer={
        <Link
          to="/notifications"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View all
          <ArrowRight size={12} />
        </Link>
      }
    >
      {isLoading && notifications.length === 0 ? (
        <WidgetSkeleton rows={3} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={CheckCircle}
          title="All caught up!"
          description="No unread notifications"
        />
      ) : (
        <div className="space-y-0.5">
          {unreadNotifications.map((n: SerializedNotification) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
