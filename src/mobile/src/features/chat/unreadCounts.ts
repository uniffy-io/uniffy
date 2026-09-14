import type { UnreadCountPayload } from "@uniffy/proto/chat/v1/chat_stream_pb";

export interface UnreadEntry {
  unread: number;
  mentions: number;
  lastReadMessageId?: string;
  firstUnreadMessageId?: string;
}

export type UnreadMap = Record<string, UnreadEntry>;

export function applyUnreadCount(
  current: UnreadMap | undefined,
  payload: UnreadCountPayload,
): UnreadMap {
  const previous = current?.[payload.channelId] ?? { unread: 0, mentions: 0 };
  return {
    ...current,
    [payload.channelId]: {
      ...previous,
      unread: payload.absolute ? payload.unreadCount : previous.unread + payload.unreadCount,
      mentions: payload.absolute ? payload.mentionCount : previous.mentions + payload.mentionCount,
      ...(payload.lastReadMessageId !== undefined
        ? { lastReadMessageId: payload.lastReadMessageId }
        : {}),
      ...(payload.firstUnreadMessageId !== undefined
        ? { firstUnreadMessageId: payload.firstUnreadMessageId }
        : {}),
    },
  };
}
