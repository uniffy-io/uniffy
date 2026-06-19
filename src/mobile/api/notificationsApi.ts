import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  NotificationsService,
  ListNotificationsRequestSchema,
  GetUnreadCountRequestSchema,
  MarkAsReadRequestSchema,
  MarkAllAsReadRequestSchema,
  DeleteNotificationRequestSchema,
} from "@uniffy/proto/notifications/v1/notifications_pb";
import { transport } from "@/lib/transport";

const client = createClient(NotificationsService, transport);

export const notificationsApi = {
  listNotifications: (req: MessageInitShape<typeof ListNotificationsRequestSchema>) =>
    client.listNotifications(req),
  getUnreadCount: (req: MessageInitShape<typeof GetUnreadCountRequestSchema>) =>
    client.getUnreadCount(req),
  markAsRead: (req: MessageInitShape<typeof MarkAsReadRequestSchema>) => client.markAsRead(req),
  markAllAsRead: (req: MessageInitShape<typeof MarkAllAsReadRequestSchema>) =>
    client.markAllAsRead(req),
  deleteNotification: (req: MessageInitShape<typeof DeleteNotificationRequestSchema>) =>
    client.deleteNotification(req),
};
