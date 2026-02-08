/**
 * Single notification item rendered in the notification panel.
 */

import { Check, Trash, Clock } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { NotificationType } from '@/gen/notifications/v1/notifications_pb';

const NOTIFICATION_TYPE_LABELS: Record<number, string> = {
    [NotificationType.CONTENT_SHARED]: 'Shared',
    [NotificationType.CONTENT_MENTIONED]: 'Mention',
    [NotificationType.CONTENT_EDITED]: 'Edited',
    [NotificationType.CALENDAR_REMINDER]: 'Reminder',
    [NotificationType.CALENDAR_INVITE]: 'Invite',
    [NotificationType.CALENDAR_RESPONSE]: 'Response',
    [NotificationType.PERMISSION_GRANTED]: 'Permission',
    [NotificationType.PERMISSION_REVOKED]: 'Permission',
    [NotificationType.SYSTEM_ANNOUNCEMENT]: 'System',
};

function formatRelativeTime(dateStr: string): string {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

interface NotificationItemProps {
    notification: SerializedNotification;
    onMarkAsRead: (id: string) => void;
    onDelete: (id: string) => void;
    onClick?: (notification: SerializedNotification) => void;
}

export function NotificationItem({
    notification,
    onMarkAsRead,
    onDelete,
    onClick,
}: NotificationItemProps) {
    const typeLabel = NOTIFICATION_TYPE_LABELS[notification.notificationType] ?? 'Notification';

    return (
        <div
            className={cn(
                'group relative flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer',
                'hover:bg-muted/50',
                !notification.isRead && 'bg-primary/5'
            )}
            onClick={() => onClick?.(notification)}
        >
            {/* Unread indicator */}
            {!notification.isRead && (
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
            )}

            <div className="flex-1 min-w-0">
                {/* Type badge + timestamp */}
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {typeLabel}
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock size={10} />
                        {formatRelativeTime(notification.createdAt)}
                    </span>
                </div>

                {/* Title */}
                <p className={cn(
                    'text-sm leading-snug truncate',
                    notification.isRead ? 'text-foreground/70' : 'text-foreground font-medium'
                )}>
                    {notification.title}
                </p>

                {/* Body preview */}
                {notification.body && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {notification.body}
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!notification.isRead && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onMarkAsRead(notification.id);
                        }}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Mark as read"
                    >
                        <Check size={14} />
                    </button>
                )}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(notification.id);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-muted transition-colors"
                    title="Delete"
                >
                    <Trash size={14} />
                </button>
            </div>
        </div>
    );
}
