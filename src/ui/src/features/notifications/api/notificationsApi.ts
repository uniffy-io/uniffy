import { createClient } from '@connectrpc/connect';
import type { CallOptions } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { NotificationsService } from '@uniffy/proto/notifications/v1/notifications_connect';
import type {
    ListNotificationsRequest,
    GetUnreadCountRequest,
    MarkAsReadRequest,
    MarkAllAsReadRequest,
    DeleteNotificationRequest,
    RegisterPushSubscriptionRequest,
    UnregisterPushSubscriptionRequest,
    StreamNotificationsRequest,
    GetVapidPublicKeyRequest,
} from '@uniffy/proto/notifications/v1/notifications_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

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
    listNotifications: async (request: PartialMessage<ListNotificationsRequest>) => {
        return notificationsClient.listNotifications(request);
    },

    /**
     * Get unread notification count.
     */
    getUnreadCount: async (request: PartialMessage<GetUnreadCountRequest>) => {
        return notificationsClient.getUnreadCount(request);
    },

    /**
     * Mark a single notification as read.
     */
    markAsRead: async (request: PartialMessage<MarkAsReadRequest>) => {
        return notificationsClient.markAsRead(request);
    },

    /**
     * Mark all notifications as read.
     */
    markAllAsRead: async (request: PartialMessage<MarkAllAsReadRequest>) => {
        return notificationsClient.markAllAsRead(request);
    },

    /**
     * Delete a notification.
     */
    deleteNotification: async (request: PartialMessage<DeleteNotificationRequest>) => {
        return notificationsClient.deleteNotification(request);
    },

    /**
     * Register a Web Push subscription.
     */
    registerPushSubscription: async (request: PartialMessage<RegisterPushSubscriptionRequest>) => {
        return notificationsClient.registerPushSubscription(request);
    },

    /**
     * Unregister a Web Push subscription.
     */
    unregisterPushSubscription: async (request: PartialMessage<UnregisterPushSubscriptionRequest>) => {
        return notificationsClient.unregisterPushSubscription(request);
    },

    /**
     * Get the VAPID public key for Web Push subscription.
     */
    getVapidPublicKey: async (request: PartialMessage<GetVapidPublicKeyRequest>) => {
        return notificationsClient.getVapidPublicKey(request);
    },

    /**
     * Stream notifications in real-time (server streaming).
     * Accepts optional CallOptions for AbortSignal support.
     */
    streamNotifications: (
        request: PartialMessage<StreamNotificationsRequest>,
        options?: CallOptions,
    ) => {
        return notificationsClient.streamNotifications(request, options);
    },
};
