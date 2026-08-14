import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  togglePanel,
  setPanel,
  setSearchQuery,
  setActiveFilter,
  selectFilteredNotifications,
} from "@/features/notifications/store/notificationsSlice";
import type { NotificationFilterType } from "@/features/notifications/store/notificationsSlice";

export function useNotifications() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.notifications);
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const filteredNotifications = useAppSelector(selectFilteredNotifications);

  const refresh = useCallback(() => {
    if (organizationId) {
      dispatch(fetchNotifications());
    }
  }, [dispatch, organizationId]);

  const markAsRead = useCallback(
    (notificationId: string) => {
      dispatch(markNotificationAsRead(notificationId));
    },
    [dispatch],
  );

  const markAllAsRead = useCallback(() => {
    dispatch(markAllNotificationsAsRead());
  }, [dispatch]);

  const remove = useCallback(
    (notificationId: string) => {
      dispatch(deleteNotification(notificationId));
    },
    [dispatch],
  );

  const toggle = useCallback(() => {
    dispatch(togglePanel());
  }, [dispatch]);

  const close = useCallback(() => {
    dispatch(setPanel(false));
  }, [dispatch]);

  const updateSearchQuery = useCallback(
    (query: string) => {
      dispatch(setSearchQuery(query));
    },
    [dispatch],
  );

  const updateFilter = useCallback(
    (filter: NotificationFilterType) => {
      dispatch(setActiveFilter(filter));
    },
    [dispatch],
  );

  return {
    notifications: state.notifications,
    filteredNotifications,
    unreadCount: state.unreadCount,
    totalCount: state.totalCount,
    loading: state.loading,
    updating: state.updating,
    error: state.error,
    panelOpen: state.panelOpen,
    searchQuery: state.searchQuery,
    activeFilter: state.activeFilter,
    refresh,
    markAsRead,
    markAllAsRead,
    remove,
    toggle,
    close,
    updateSearchQuery,
    updateFilter,
  };
}

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

export function useUnreadCountPolling(intervalMs: number = 60000) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const unreadCount = useAppSelector((s) => s.notifications.unreadCount);

  useEffect(() => {
    if (!organizationId) return;

    dispatch(fetchUnreadCount());

    const interval = setInterval(() => {
      dispatch(fetchUnreadCount());
    }, intervalMs);

    return () => clearInterval(interval);
  }, [dispatch, organizationId, intervalMs]);

  return unreadCount;
}
