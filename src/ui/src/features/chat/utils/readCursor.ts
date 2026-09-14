/**
 * The first message the viewer has not read, anchored on the server read cursor.
 *
 * Deriving this from `unreadCount` breaks the moment unread exceeds the loaded
 * page or hits the server's 100 cap, because that arithmetic assumes every
 * unread message is present in the window.
 *
 * `messageIds` is the loaded window in ascending order.
 */
export function firstUnreadMessageId(
  messageIds: string[],
  lastReadMessageId: string | undefined,
): string | null {
  if (messageIds.length === 0) return null;

  // No cursor at all: nothing in this channel was ever read.
  if (!lastReadMessageId) return messageIds[0];

  const cursorIndex = messageIds.indexOf(lastReadMessageId);

  // The cursor sits before the loaded window, so everything loaded is unread.
  if (cursorIndex === -1) return messageIds[0];

  return messageIds[cursorIndex + 1] ?? null;
}
