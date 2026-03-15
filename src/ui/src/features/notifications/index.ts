/**
 * Notifications feature public exports.
 *
 * Provides real-time notification management with server streaming,
 * unread badge, and notification panel.
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
    fetchNotifications,
    fetchUnreadCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
} from '@/features/notifications/store/notificationsSlice';

export type {
    SerializedNotification,
    NotificationsState,
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
export { PushNotificationBanner } from '@/features/notifications/components/PushNotificationBanner';
