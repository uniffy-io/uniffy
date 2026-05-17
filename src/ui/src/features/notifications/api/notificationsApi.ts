import { createClient } from '@connectrpc/connect';
import type { CallOptions } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { NotificationsService, BulkDeleteNotificationsRequestSchema, BulkMarkAsReadRequestSchema, DeleteNotificationRequestSchema, GetNotificationStatsRequestSchema, GetUnreadCountRequestSchema, GetVapidPublicKeyRequestSchema, ListNotificationsRequestSchema, MarkAllAsReadRequestSchema, MarkAsReadRequestSchema, RegisterPushSubscriptionRequestSchema, SearchNotificationsRequestSchema, StreamNotificationsRequestSchema, UnregisterPushSubscriptionRequestSchema } from '@uniffy/proto/notifications/v1/notifications_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a notifications service client with the shared transport.
 */
const notificationsClient = createClient(NotificationsService, transport);

/**
 * Notifications API service with typed methods.
 */
export const notificationsApi = {
    /**
     * List notifications with pagination and filters.
     */
    listNotifications: async (request: MessageInitShape<typeof ListNotificationsRequestSchema>) => {
        return notificationsClient.listNotifications(request);
    },

    /**
     * Get unread notification count.
     */
    getUnreadCount: async (request: MessageInitShape<typeof GetUnreadCountRequestSchema>) => {
        return notificationsClient.getUnreadCount(request);
    },

    /**
     * Mark a single notification as read.
     */
    markAsRead: async (request: MessageInitShape<typeof MarkAsReadRequestSchema>) => {
        return notificationsClient.markAsRead(request);
    },

    /**
     * Mark all notifications as read.
     */
    markAllAsRead: async (request: MessageInitShape<typeof MarkAllAsReadRequestSchema>) => {
        return notificationsClient.markAllAsRead(request);
    },

    /**
     * Delete a notification.
     */
    deleteNotification: async (request: MessageInitShape<typeof DeleteNotificationRequestSchema>) => {
        return notificationsClient.deleteNotification(request);
    },

    /**
     * Register a Web Push subscription.
     */
    registerPushSubscription: async (request: MessageInitShape<typeof RegisterPushSubscriptionRequestSchema>) => {
        return notificationsClient.registerPushSubscription(request);
    },

    /**
     * Unregister a Web Push subscription.
     */
    unregisterPushSubscription: async (request: MessageInitShape<typeof UnregisterPushSubscriptionRequestSchema>) => {
        return notificationsClient.unregisterPushSubscription(request);
    },

    /**
     * Get the VAPID public key for Web Push subscription.
     */
    getVapidPublicKey: async (request: MessageInitShape<typeof GetVapidPublicKeyRequestSchema>) => {
        return notificationsClient.getVapidPublicKey(request);
    },

    /**
     * Stream notifications in real-time (server streaming).
     * Accepts optional CallOptions for AbortSignal support.
     */
    streamNotifications: (
        request: MessageInitShape<typeof StreamNotificationsRequestSchema>,
        options?: CallOptions,
    ) => {
        return notificationsClient.streamNotifications(request, options);
    },

    /**
     * Search notifications with full-text search and advanced filters.
     */
    searchNotifications: async (request: MessageInitShape<typeof SearchNotificationsRequestSchema>) => {
        return notificationsClient.searchNotifications(request);
    },

    /**
     * Get aggregated notification statistics for analytics.
     */
    getNotificationStats: async (request: MessageInitShape<typeof GetNotificationStatsRequestSchema>) => {
        return notificationsClient.getNotificationStats(request);
    },

    /**
     * Mark multiple notifications as read in bulk.
     */
    bulkMarkAsRead: async (request: MessageInitShape<typeof BulkMarkAsReadRequestSchema>) => {
        return notificationsClient.bulkMarkAsRead(request);
    },

    /**
     * Delete multiple notifications in bulk.
     */
    bulkDeleteNotifications: async (request: MessageInitShape<typeof BulkDeleteNotificationsRequestSchema>) => {
        return notificationsClient.bulkDeleteNotifications(request);
    },
};
