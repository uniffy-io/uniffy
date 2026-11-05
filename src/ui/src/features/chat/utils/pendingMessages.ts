import type { ChatMessage } from "@/features/chat/types";

export function pendingMessageId(senderId: string, clientMessageId: string): string {
  return `pending:${senderId}:${clientMessageId}`;
}

export function retainPendingMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const confirmed = new Set(
    incoming
      .filter((m) => m.clientMessageId)
      .map((m) => pendingMessageId(m.senderId, m.clientMessageId!)),
  );
  return [...incoming, ...existing.filter((m) => m.sendStatus && !confirmed.has(m.id))];
}
