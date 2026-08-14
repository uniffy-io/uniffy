import { createClient } from "@connectrpc/connect";
import type { CallOptions } from "@connectrpc/connect";
import { transport } from "@/config/api";
import {
  NotificationsService,
  BulkDeleteNotificationsRequestSchema,
  BulkMarkAsReadRequestSchema,
  DeleteNotificationRequestSchema,
  GetNotificationStatsRequestSchema,
  GetUnreadCountRequestSchema,
  GetVapidPublicKeyRequestSchema,
  ListNotificationsRequestSchema,
  MarkAllAsReadRequestSchema,
  MarkAsReadRequestSchema,
  RegisterPushSubscriptionRequestSchema,
  SearchNotificationsRequestSchema,
  StreamNotificationsRequestSchema,
  UnregisterPushSubscriptionRequestSchema,
} from "@uniffy/proto/notifications/v1/notifications_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const notificationsClient = createClient(NotificationsService, transport);

export const notificationsApi = {
  listNotifications: async (request: MessageInitShape<typeof ListNotificationsRequestSchema>) => {
    return notificationsClient.listNotifications(request);
  },

  getUnreadCount: async (request: MessageInitShape<typeof GetUnreadCountRequestSchema>) => {
    return notificationsClient.getUnreadCount(request);
  },

  markAsRead: async (request: MessageInitShape<typeof MarkAsReadRequestSchema>) => {
    return notificationsClient.markAsRead(request);
  },

  markAllAsRead: async (request: MessageInitShape<typeof MarkAllAsReadRequestSchema>) => {
    return notificationsClient.markAllAsRead(request);
  },

  deleteNotification: async (request: MessageInitShape<typeof DeleteNotificationRequestSchema>) => {
    return notificationsClient.deleteNotification(request);
  },

  registerPushSubscription: async (
    request: MessageInitShape<typeof RegisterPushSubscriptionRequestSchema>,
  ) => {
    return notificationsClient.registerPushSubscription(request);
  },

  unregisterPushSubscription: async (
    request: MessageInitShape<typeof UnregisterPushSubscriptionRequestSchema>,
  ) => {
    return notificationsClient.unregisterPushSubscription(request);
  },

  getVapidPublicKey: async (request: MessageInitShape<typeof GetVapidPublicKeyRequestSchema>) => {
    return notificationsClient.getVapidPublicKey(request);
  },

  streamNotifications: (
    request: MessageInitShape<typeof StreamNotificationsRequestSchema>,
    options?: CallOptions,
  ) => {
    return notificationsClient.streamNotifications(request, options);
  },

  searchNotifications: async (
    request: MessageInitShape<typeof SearchNotificationsRequestSchema>,
  ) => {
    return notificationsClient.searchNotifications(request);
  },

  getNotificationStats: async (
    request: MessageInitShape<typeof GetNotificationStatsRequestSchema>,
  ) => {
    return notificationsClient.getNotificationStats(request);
  },

  bulkMarkAsRead: async (request: MessageInitShape<typeof BulkMarkAsReadRequestSchema>) => {
    return notificationsClient.bulkMarkAsRead(request);
  },

  bulkDeleteNotifications: async (
    request: MessageInitShape<typeof BulkDeleteNotificationsRequestSchema>,
  ) => {
    return notificationsClient.bulkDeleteNotifications(request);
  },
};
