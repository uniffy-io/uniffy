import { useMemo } from 'react';

import { type ChatMessage } from '@/features/chat/mock/types';

export interface GroupedMessage {
  message: ChatMessage;
  isGrouped: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showDateSeparator: boolean;
  dateLabel: string;
}

const GROUPING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function getDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) {
    return 'Today';
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function useMessageGrouping(messages: ChatMessage[]): GroupedMessage[] {
  return useMemo(() => {
    if (messages.length === 0) return [];

    const result: GroupedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const current = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;

      const currentDate = new Date(current.createdAt);
      const prevDate = prev ? new Date(prev.createdAt) : null;

      // Date separator: show when day changes from previous message
      const showDateSeparator = !prev || !isSameDay(currentDate, prevDate!);
      const dateLabel = getDateLabel(currentDate);

      // Grouping: same sender within threshold, both non-system messages
      const canGroupWithPrev =
        prev !== null &&
        !showDateSeparator &&
        prev.senderId === current.senderId &&
        prev.senderType !== 'SYSTEM' &&
        current.senderType !== 'SYSTEM' &&
        !current.isDeleted &&
        !prev.isDeleted &&
        currentDate.getTime() - new Date(prev.createdAt).getTime() <= GROUPING_THRESHOLD_MS;

      const nextDate = next ? new Date(next.createdAt) : null;
      const canGroupWithNext =
        next !== null &&
        (nextDate !== null && isSameDay(currentDate, nextDate)) &&
        next.senderId === current.senderId &&
        next.senderType !== 'SYSTEM' &&
        current.senderType !== 'SYSTEM' &&
        !current.isDeleted &&
        !next.isDeleted &&
        nextDate.getTime() - currentDate.getTime() <= GROUPING_THRESHOLD_MS;

      result.push({
        message: current,
        isGrouped: canGroupWithPrev,
        isFirstInGroup: !canGroupWithPrev,
        isLastInGroup: !canGroupWithNext,
        showDateSeparator,
        dateLabel,
      });
    }

    return result;
  }, [messages]);
}
