/**
 * Notifications feature public exports.
 *
 * Provides real-time notification management with server streaming,
 * unread badge, notification panel with search and filters, and
 * full-page notifications view.
 */

export { notificationsApi } from '@/features/notifications/api/notificationsApi';

export {
    notificationsReducer,
    clearNotifications,
    togglePanel,
    setPanel,
    addRealtimeNotification,
    setUnreadCount,
    clearError,
    setSearchQuery,
    setActiveFilter,
    selectFilteredNotifications,
    fetchNotifications,
    fetchUnreadCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
} from '@/features/notifications/store/notificationsSlice';

export type {
    SerializedNotification,
    NotificationsState,
    NotificationFilterType,
} from '@/features/notifications/store/notificationsSlice';

export {
    useNotifications,
    useUnreadCount,
    useUnreadCountPolling,
} from '@/features/notifications/hooks/useNotifications';

export { useNotificationStream } from '@/features/notifications/hooks/useNotificationStream';

export { usePushSubscription } from '@/features/notifications/hooks/usePushSubscription';
export type { UsePushSubscriptionResult, SubscribeResult } from '@/features/notifications/hooks/usePushSubscription';

export { NotificationBell } from '@/features/notifications/components/NotificationBell';
export { NotificationPanel } from '@/features/notifications/components/NotificationPanel';
export { NotificationItem } from '@/features/notifications/components/NotificationItem';
export { NotificationFilterBar } from '@/features/notifications/components/NotificationFilterBar';
export { NotificationSearch } from '@/features/notifications/components/NotificationSearch';
export { PushNotificationBanner } from '@/features/notifications/components/PushNotificationBanner';
export { NotificationToast } from '@/features/notifications/components/NotificationToast';

export {
    notificationsPageReducer,
    searchPageNotifications,
    fetchPageNotificationStats,
    bulkMarkAsReadPage,
    bulkDeleteNotificationsPage,
} from '@/features/notifications/store/notificationsPageSlice';

export type {
    NotificationsPageState,
    SerializedPageNotification,
    PageViewMode,
    NotificationStats,
} from '@/features/notifications/store/notificationsPageSlice';
