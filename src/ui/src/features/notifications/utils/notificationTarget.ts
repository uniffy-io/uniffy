import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { urnToPath } from "@/shared/utils/urn";

interface NotificationTarget {
  notificationType: number;
  sourceUrn: string;
  metadata: Record<string, string>;
}

// Chat notifications carry the CHAT channel URN as their source; the message that
// triggered them only exists in metadata.
const CHAT_MESSAGE_TYPES: readonly number[] = [
  NotificationType.CHAT_MENTION,
  NotificationType.CHAT_DM,
  NotificationType.CHAT_THREAD_REPLY,
];

/** Route for a notification, or null when it points at nothing navigable. */
export function notificationTargetPath(notification: NotificationTarget): string | null {
  if (CHAT_MESSAGE_TYPES.includes(notification.notificationType)) {
    const channelId = notification.metadata?.channel_id;
    const messageId = notification.metadata?.message_id;
    if (channelId) {
      return messageId ? `/chat/${channelId}#${messageId}` : `/chat/${channelId}`;
    }
  }

  if (!notification.sourceUrn) return null;
  const path = urnToPath(notification.sourceUrn);
  return path === "#" ? null : path;
}
