import type { SerializedMessage } from "@features/chat/chatSerializer";
import type { SendRequest } from "@features/chat/pendingSends";

export function localSend(
  request: SendRequest,
  userId: string,
  failed: boolean,
  name = "You",
): SerializedMessage {
  const now = new Date();
  return {
    id: `optimistic-${request.clientMessageId}`,
    clientMessageId: request.clientMessageId,
    channelId: request.channelId,
    senderId: userId,
    senderType: "USER",
    content: request.content,
    rootId: request.rootId ?? null,
    replyToId: request.replyToId ?? null,
    replyContext: null,
    threadReplyContext: null,
    editedAtSeconds: null,
    isDeleted: false,
    isPinned: false,
    metadata: {
      optimistic: "1",
      ...(failed ? { failed: "1" } : {}),
      ...(request.attachmentFileIds?.length
        ? { attachmentIds: request.attachmentFileIds.join(",") }
        : {}),
    },
    createdAtSeconds: Math.floor(now.getTime() / 1000),
    createdAtIso: now.toISOString(),
    timeLabel: failed ? "Send not confirmed" : "Sending...",
    replyCount: 0,
    reactions: [],
    senderName: name,
    senderAvatarUrl: null,
    attachments: [],
  };
}
export function mergeSendRows(
  existing: SerializedMessage[],
  incoming: SerializedMessage[],
): SerializedMessage[] {
  incoming = incoming.filter(
    (row) =>
      row.metadata.optimistic !== "1" ||
      !existing.some(
        (saved) =>
          saved.metadata.optimistic !== "1" &&
          saved.clientMessageId === row.clientMessageId &&
          saved.senderId === row.senderId,
      ),
  );
  const ids = new Set(incoming.map((row) => row.id));
  const confirmed = new Set(
    incoming
      .filter((row) => row.clientMessageId && row.metadata.optimistic !== "1")
      .map((row) => `${row.senderId}:${row.clientMessageId}`),
  );
  return [
    ...incoming,
    ...existing.filter(
      (row) =>
        !ids.has(row.id) &&
        !(
          row.metadata.optimistic === "1" && confirmed.has(`${row.senderId}:${row.clientMessageId}`)
        ),
    ),
  ].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
}
