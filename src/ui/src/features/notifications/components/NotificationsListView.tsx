import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BellSimple,
    CaretLeft,
    CaretRight,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { notificationTargetPath } from '@/features/notifications/utils/notificationTarget';
import { NotificationItem } from '@/features/notifications/components/NotificationItem';
import { markNotificationAsRead, deleteNotification } from '@/features/notifications/store/notificationsSlice';
import {
    setPage,
    toggleSelectedId,
} from '@/features/notifications/store/notificationsPageSlice';
import type { SerializedPageNotification } from '@/features/notifications/store/notificationsPageSlice';

interface TimeGroup {
    label: string;
    notifications: SerializedPageNotification[];
}

function groupByTime(notifications: SerializedPageNotification[]): TimeGroup[] {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const groups: Record<string, SerializedPageNotification[]> = {
        Today: [],
        Yesterday: [],
        'This Week': [],
        Earlier: [],
    };

    for (const n of notifications) {
        const date = new Date(n.createdAt);
        if (date >= todayStart) {
            groups['Today'].push(n);
        } else if (date >= yesterdayStart) {
            groups['Yesterday'].push(n);
        } else if (date >= weekStart) {
            groups['This Week'].push(n);
        } else {
            groups['Earlier'].push(n);
        }
    }

    return Object.entries(groups)
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => ({ label, notifications: items }));
}

export function NotificationsListView() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();

    const notifications = useAppSelector((s) => s.notificationsPage.notifications);
    const loading = useAppSelector((s) => s.notificationsPage.loading);
    const selectedIds = useAppSelector((s) => s.notificationsPage.selectedIds);
    const page = useAppSelector((s) => s.notificationsPage.page);
    const pageSize = useAppSelector((s) => s.notificationsPage.pageSize);
    const totalCount = useAppSelector((s) => s.notificationsPage.totalCount);

    const timeGroups = useMemo(() => groupByTime(notifications), [notifications]);
    const totalPages = Math.ceil(totalCount / pageSize);

    const handleMarkAsRead = useCallback((id: string) => {
        dispatch(markNotificationAsRead(id));
    }, [dispatch]);

    const handleDelete = useCallback((id: string) => {
        dispatch(deleteNotification(id));
    }, [dispatch]);

    const handleClick = useCallback((notification: SerializedPageNotification) => {
        if (!notification.isRead) {
            dispatch(markNotificationAsRead(notification.id));
        }
        const path = notificationTargetPath(notification);
        if (path) {
            navigate(path);
        }
    }, [dispatch, navigate]);

    const handlePageChange = useCallback((newPage: number) => {
        dispatch(setPage(newPage));
    }, [dispatch]);

    if (loading && notifications.length === 0) {
        return (
            <div className="px-4 md:px-6 py-4 space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                        <div className="flex-1 space-y-2">
                            <div className="h-3.5 bg-muted rounded w-3/4" />
                            <div className="h-3 bg-muted/60 rounded w-1/2" />
                            <div className="h-2.5 bg-muted/40 rounded w-1/4" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (notifications.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-6">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
                    <BellSimple size={32} weight="duotone" className="text-muted-foreground/50" />
                </div>
                <p className="text-base font-medium text-foreground/60 mb-1">
                    No notifications found
                </p>
                <p className="text-sm text-muted-foreground/60 text-center max-w-[300px]">
                    Try adjusting your filters or search query to find what you are looking for.
                </p>
            </div>
        );
    }

    return (
        <div>
            {timeGroups.map((group) => (
                <div key={group.label}>
                    <div className="sticky top-0 z-[5] px-4 md:px-6 py-1.5 bg-card/95 backdrop-blur-sm border-b border-border/50">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                            {group.label}
                        </span>
                    </div>
                    {group.notifications.map((notification) => (
                        <div
                            key={notification.id}
                            className={cn(
                                'relative flex items-start transition-colors',
                                notification.isRead
                                    ? 'hover:bg-muted/30'
                                    : 'bg-primary/10 hover:bg-primary/15',
                            )}
                        >
                            {!notification.isRead && (
                                <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                            )}
                            <div className="flex items-center pl-2 md:pl-4 pt-4 shrink-0">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        dispatch(toggleSelectedId(notification.id));
                                    }}
                                    className={cn(
                                        'w-4 h-4 rounded border-2 transition-colors flex items-center justify-center',
                                        selectedIds.includes(notification.id)
                                            ? 'bg-primary border-primary'
                                            : 'border-border hover:border-primary/60'
                                    )}
                                >
                                    {selectedIds.includes(notification.id) && (
                                        <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <NotificationItem
                                    notification={notification}
                                    onMarkAsRead={handleMarkAsRead}
                                    onDelete={handleDelete}
                                    onClick={() => handleClick(notification)}
                                    hideRowBackground
                                />
                            </div>
                        </div>
                    ))}
                </div>
            ))}

            {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 md:px-6 py-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                        Page {page} of {totalPages} ({totalCount} total)
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => handlePageChange(page - 1)}
                            disabled={page <= 1}
                            className={cn(
                                'p-1.5 rounded-md transition-colors',
                                page <= 1
                                    ? 'text-muted-foreground/30 cursor-not-allowed'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            )}
                        >
                            <CaretLeft size={14} />
                        </button>
                        <button
                            onClick={() => handlePageChange(page + 1)}
                            disabled={page >= totalPages}
                            className={cn(
                                'p-1.5 rounded-md transition-colors',
                                page >= totalPages
                                    ? 'text-muted-foreground/30 cursor-not-allowed'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            )}
                        >
                            <CaretRight size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
