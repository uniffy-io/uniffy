import { useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, ArrowRight } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  WidgetCard,
  EmptyWidget,
  WidgetSkeleton,
} from "@/features/dashboard/components/widgets/WidgetCard";
import { NotificationItem } from "@/features/notifications/components/NotificationItem";
import { useNotificationAction } from "@/features/notifications/hooks/useNotificationAction";
import {
  deleteNotification,
  markNotificationAsRead,
} from "@/features/notifications/store/notificationsSlice";

const MAX_NOTIFICATIONS = 4;

export function NotificationsSummaryWidget() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.notifications.notifications);
  const unreadCount = useAppSelector((state) => state.notifications.unreadCount);
  const isLoading = useAppSelector((state) => state.notifications.loading);

  const markAsRead = useCallback(
    (id: string) => {
      dispatch(markNotificationAsRead(id));
    },
    [dispatch],
  );
  const remove = useCallback(
    (id: string) => {
      dispatch(deleteNotification(id));
    },
    [dispatch],
  );
  const openNotification = useNotificationAction(undefined, markAsRead);

  const recent = notifications.slice(0, MAX_NOTIFICATIONS);

  return (
    <WidgetCard
      title="Notifications"
      icon={Bell}
      colSpan={2}
      priority={2}
      action={
        unreadCount > 0 ? (
          <span className="flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
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
      {isLoading && recent.length === 0 ? (
        <WidgetSkeleton rows={3} />
      ) : recent.length === 0 ? (
        <EmptyWidget
          icon={Bell}
          title="No notifications yet"
          description="Shares, mentions and task updates will show up here"
        />
      ) : (
        // Rows run edge to edge so the unread highlight spans the card, as in the bell panel.
        <div className="-mx-6">
          {recent.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkAsRead={markAsRead}
              onDelete={remove}
              onClick={openNotification}
              className="px-6"
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
