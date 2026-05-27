import { useEffect, useRef, useMemo, useCallback } from 'react';
import { CheckCircle, ArrowsClockwise, BellSimple, X, ArrowRight } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { NotificationItem } from '@/features/notifications/components/NotificationItem';
import { NotificationFilterBar } from '@/features/notifications/components/NotificationFilterBar';
import { NotificationSearch } from '@/features/notifications/components/NotificationSearch';
import {
    selectFilteredNotifications,
    setSearchQuery,
    setActiveFilter,
} from '@/features/notifications/store/notificationsSlice';
import type {
    SerializedNotification,
    NotificationFilterType,
} from '@/features/notifications/store/notificationsSlice';
import { useNavigate } from 'react-router-dom';
import { parseUrn, urnToPath } from '@/shared/utils/urn';

interface TimeGroup {
    label: string;
    notifications: SerializedNotification[];
}

function groupByTime(notifications: SerializedNotification[]): TimeGroup[] {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const groups: Record<string, SerializedNotification[]> = {
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

interface NotificationPanelProps {
    onClose: () => void;
    anchorRef?: React.RefObject<HTMLElement | null>;
}

function PanelContent({
    loading,
    unreadCount,
    refresh,
    markAllAsRead,
    filteredNotifications,
    timeGroups,
    notifications,
    onNotificationClick,
    markAsRead,
    remove,
    onClose,
    isMobile,
    searchQuery,
    activeFilter,
    onSearchChange,
    onFilterChange,
    onViewAll,
}: {
    loading: boolean;
    unreadCount: number;
    refresh: () => void;
    markAllAsRead: () => void;
    filteredNotifications: SerializedNotification[];
    timeGroups: TimeGroup[];
    notifications: SerializedNotification[];
    onNotificationClick: (n: SerializedNotification) => void;
    markAsRead: (id: string) => void;
    remove: (id: string) => void;
    onClose: () => void;
    isMobile: boolean;
    searchQuery: string;
    activeFilter: NotificationFilterType;
    onSearchChange: (query: string) => void;
    onFilterChange: (filter: NotificationFilterType) => void;
    onViewAll: () => void;
}) {
    return (
        <>
            <div className="px-4 pt-3.5 pb-2.5 border-b border-border shrink-0 space-y-2.5">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                        Notifications
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
                        {isMobile && (
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title="Close"
                            >
                                <X size={14} weight="bold" />
                            </button>
                        )}
                    </div>
                </div>

                <NotificationSearch
                    value={searchQuery}
                    onChange={onSearchChange}
                />

                <NotificationFilterBar
                    activeFilter={activeFilter}
                    onFilterChange={onFilterChange}
                    unreadCount={unreadCount}
                />
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading && notifications.length === 0 ? (
                    <div className="px-4 py-3 space-y-4">
                        {[1, 2, 3].map((i) => (
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
                ) : filteredNotifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mb-3">
                            <BellSimple size={24} weight="duotone" className="text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-medium text-foreground/60 mb-1">
                            {activeFilter === 'unread' ? 'All caught up' : searchQuery ? 'No matches' : 'No notifications yet'}
                        </p>
                        <p className="text-xs text-muted-foreground/60 text-center max-w-[200px]">
                            {activeFilter === 'unread'
                                ? 'You have no unread notifications'
                                : searchQuery
                                    ? 'Try a different search term or filter'
                                    : 'Notifications about shares, mentions, and updates will appear here'
                            }
                        </p>
                    </div>
                ) : (
                    <div>
                        {timeGroups.map((group) => (
                            <div key={group.label}>
                                <div className="sticky top-0 z-10 px-4 py-1.5 bg-card/95 backdrop-blur-sm border-b border-border/50">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                        {group.label}
                                    </span>
                                </div>
                                <div>
                                    {group.notifications.map((notification) => (
                                        <NotificationItem
                                            key={notification.id}
                                            notification={notification}
                                            onMarkAsRead={markAsRead}
                                            onDelete={remove}
                                            onClick={onNotificationClick}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="shrink-0 border-t border-border">
                <button
                    onClick={onViewAll}
                    className={cn(
                        'flex items-center justify-center gap-1.5 w-full px-4 py-2.5',
                        'text-xs font-medium text-muted-foreground',
                        'hover:text-primary hover:bg-muted/30 transition-colors'
                    )}
                >
                    View all notifications
                    <ArrowRight size={12} />
                </button>
            </div>
        </>
    );
}

export function NotificationPanel({ onClose, anchorRef }: NotificationPanelProps) {
    const dispatch = useAppDispatch();
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
    const { isMobile } = useBreakpoint();

    const searchQuery = useAppSelector((s) => s.notifications.searchQuery);
    const activeFilter = useAppSelector((s) => s.notifications.activeFilter);
    const filteredNotifications = useAppSelector(selectFilteredNotifications);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (isMobile) return;

        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (panelRef.current && !panelRef.current.contains(target)
                && !(anchorRef?.current && anchorRef.current.contains(target))) {
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
    }, [onClose, isMobile, anchorRef]);

    useEffect(() => {
        if (!isMobile) return;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, [isMobile]);

    const timeGroups = useMemo(() => groupByTime(filteredNotifications), [filteredNotifications]);

    const handleNotificationClick = useCallback((notification: SerializedNotification) => {
        if (!notification.isRead) {
            markAsRead(notification.id);
        }

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
    }, [markAsRead, navigate, onClose]);

    const handleSearchChange = useCallback((query: string) => {
        dispatch(setSearchQuery(query));
    }, [dispatch]);

    const handleFilterChange = useCallback((filter: NotificationFilterType) => {
        dispatch(setActiveFilter(filter));
    }, [dispatch]);

    const handleViewAll = useCallback(() => {
        navigate('/notifications');
        onClose();
    }, [navigate, onClose]);

    const contentProps = {
        loading,
        unreadCount,
        refresh,
        markAllAsRead,
        filteredNotifications,
        timeGroups,
        notifications,
        onNotificationClick: handleNotificationClick,
        markAsRead,
        remove,
        onClose,
        isMobile,
        searchQuery,
        activeFilter,
        onSearchChange: handleSearchChange,
        onFilterChange: handleFilterChange,
        onViewAll: handleViewAll,
    };

    if (isMobile) {
        return (
            <>
                <div
                    className="fixed inset-0 z-[99] bg-black/50 animate-in fade-in duration-200"
                    onClick={onClose}
                />
                <div
                    ref={panelRef}
                    className={cn(
                        'fixed inset-x-0 bottom-0 z-[100] max-h-[85dvh]',
                        'bg-card border-t border-border rounded-t-2xl shadow-xl',
                        'animate-in slide-in-from-bottom duration-300',
                        'flex flex-col overflow-hidden'
                    )}
                >
                    <div className="flex justify-center pt-2 pb-1 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
                    </div>
                    <PanelContent {...contentProps} />
                </div>
            </>
        );
    }

    return (
        <div
            ref={panelRef}
            className={cn(
                'absolute right-0 z-[100] mt-1.5 w-[min(440px,calc(100vw-2rem))] max-h-[70vh] origin-top-right rounded-xl',
                'bg-card shadow-xl border border-border',
                'animate-in fade-in slide-in-from-top-2 duration-200',
                'flex flex-col overflow-hidden'
            )}
        >
            <PanelContent {...contentProps} />
        </div>
    );
}
