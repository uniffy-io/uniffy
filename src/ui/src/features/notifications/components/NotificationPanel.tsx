/**
 * Notification panel dropdown showing the list of notifications.
 */

import { useEffect, useRef } from 'react';
import { CheckCircle, ArrowsClockwise } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { NotificationItem } from '@/features/notifications/components/NotificationItem';
import { useNavigate } from 'react-router-dom';
import { parseUrn, urnToPath } from '@/shared/utils/urn';

interface NotificationPanelProps {
    onClose: () => void;
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
    const {
        notifications,
        unreadCount,
        loading,
        refresh,
        markAsRead,
        markAllAsRead,
        remove,
    } = useNotifications();
    const navigate = useNavigate();
    const panelRef = useRef<HTMLDivElement>(null);

    // Fetch notifications on mount
    useEffect(() => {
        refresh();
    }, [refresh]);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        const timeoutId = setTimeout(() => {
            document.addEventListener('click', handleClickOutside, true);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('click', handleClickOutside, true);
        };
    }, [onClose]);

    const handleNotificationClick = (notification: typeof notifications[0]) => {
        // Mark as read
        if (!notification.isRead) {
            markAsRead(notification.id);
        }

        // Navigate to source if available
        if (notification.sourceUrn) {
            const parsed = parseUrn(notification.sourceUrn);
            if (parsed) {
                const path = urnToPath(notification.sourceUrn);
                if (path) {
                    navigate(path);
                    onClose();
                }
            }
        }
    };

    return (
        <div
            ref={panelRef}
            className={cn(
                'absolute right-0 z-[100] mt-1.5 w-96 max-h-[70vh] origin-top-right rounded-lg',
                'bg-card shadow-lg border border-border',
                'animate-in fade-in slide-in-from-top-2 duration-200',
                'flex flex-col overflow-hidden'
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">
                    Notifications
                    {unreadCount > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {unreadCount} unread
                        </span>
                    )}
                </h3>
                <div className="flex items-center gap-1">
                    <button
                        onClick={refresh}
                        disabled={loading}
                        className={cn(
                            'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                            loading && 'animate-spin'
                        )}
                        title="Refresh"
                    >
                        <ArrowsClockwise size={14} />
                    </button>
                    {unreadCount > 0 && (
                        <button
                            onClick={markAllAsRead}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Mark all as read"
                        >
                            <CheckCircle size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto">
                {loading && notifications.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        Loading...
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                        <p>No notifications</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {notifications.map((notification) => (
                            <NotificationItem
                                key={notification.id}
                                notification={notification}
                                onMarkAsRead={markAsRead}
                                onDelete={remove}
                                onClick={handleNotificationClick}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
