import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { JOIN_CALL_PARAM, JOIN_CALL_VALUE } from "@/features/chat/hooks/useJoinCallParam";
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

/**
 * Channel of the meeting a reminder is for, when the event is bound to one.
 * Reminders for unbound events resolve through the ordinary URN path instead.
 */
export function meetingChannelIdFor(notification: NotificationTarget): string | null {
  if (notification.notificationType !== NotificationType.CALENDAR_REMINDER) return null;
  return notification.metadata?.channel_id || null;
}

/**
 * Href for surfaces that navigate rather than dispatch - the dashboard widget
 * and the push-click redirect. A bound meeting resolves to the channel carrying
 * the join intent, which the chat page consumes on arrival; everything else
 * routes normally.
 */
export function notificationHref(notification: NotificationTarget): string | null {
  const channelId = meetingChannelIdFor(notification);
  if (channelId) return `/chat/${channelId}?${JOIN_CALL_PARAM}=${JOIN_CALL_VALUE}`;
  return notificationTargetPath(notification);
}

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
