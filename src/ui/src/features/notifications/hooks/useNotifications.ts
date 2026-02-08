/**
 * React hooks for notifications feature.
 *
 * Provides hooks for accessing notification state, managing the
 * notification panel, and interacting with notifications.
 */

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchNotifications,
    fetchUnreadCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    togglePanel,
    setPanel,
} from '@/features/notifications/store/notificationsSlice';

/**
 * Main notifications hook. Provides full notifications state and actions.
 */
export function useNotifications() {
    const dispatch = useAppDispatch();
    const state = useAppSelector((s) => s.notifications);
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

    const refresh = useCallback(() => {
        if (organizationId) {
            dispatch(fetchNotifications());
        }
    }, [dispatch, organizationId]);

    const markAsRead = useCallback((notificationId: string) => {
        dispatch(markNotificationAsRead(notificationId));
    }, [dispatch]);

    const markAllAsRead = useCallback(() => {
        dispatch(markAllNotificationsAsRead());
    }, [dispatch]);

    const remove = useCallback((notificationId: string) => {
        dispatch(deleteNotification(notificationId));
    }, [dispatch]);

    const toggle = useCallback(() => {
        dispatch(togglePanel());
    }, [dispatch]);

    const close = useCallback(() => {
        dispatch(setPanel(false));
    }, [dispatch]);

    return {
        notifications: state.notifications,
        unreadCount: state.unreadCount,
        totalCount: state.totalCount,
        loading: state.loading,
        updating: state.updating,
        error: state.error,
        panelOpen: state.panelOpen,
        refresh,
        markAsRead,
        markAllAsRead,
        remove,
        toggle,
        close,
    };
}

/**
 * Hook that returns just the unread count. Use for badge display.
 */
export function useUnreadCount() {
    const dispatch = useAppDispatch();
    const unreadCount = useAppSelector((s) => s.notifications.unreadCount);
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

    useEffect(() => {
        if (organizationId) {
            dispatch(fetchUnreadCount());
        }
    }, [dispatch, organizationId]);

    return unreadCount;
}

/**
 * Hook that polls for unread count at a given interval.
 */
export function useUnreadCountPolling(intervalMs: number = 60000) {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const unreadCount = useAppSelector((s) => s.notifications.unreadCount);

    useEffect(() => {
        if (!organizationId) return;

        // Initial fetch
        dispatch(fetchUnreadCount());

        const interval = setInterval(() => {
            dispatch(fetchUnreadCount());
        }, intervalMs);

        return () => clearInterval(interval);
    }, [dispatch, organizationId, intervalMs]);

    return unreadCount;
}
