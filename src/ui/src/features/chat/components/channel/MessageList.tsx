/**
 * MessageList - Main scrollable message list for a channel.
 *
 * Reads messages from Redux, groups consecutive same-sender messages,
 * renders date separators, unread separators, and MessageItem components.
 * Auto-scrolls to the bottom on mount and when new messages arrive.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Hash, Lock } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import {
  selectActiveChannelId,
} from '@/features/chat/store/chatChannelsSlice';
import {
  selectMessagesForChannel,
  selectUnreadSeparatorForChannel,
  selectTypingUsers,
  selectHasMoreForChannel,
  selectIsChannelLoading,
} from '@/features/chat/store/chatMessagesSlice';
import { fetchMessages } from '@/features/chat/store/chatThunks';
import {
  selectJumpToMessageId,
  clearJumpToMessage,
} from '@/features/chat/store/chatUiSlice';
import { MessageItem } from '@/features/chat/components/channel/MessageItem';
import { TypingIndicator } from '@/features/chat/components/channel/TypingIndicator';
import { NewMessagesPill } from '@/features/chat/components/channel/NewMessagesPill';
import type { ChatMessage } from '@/features/chat/types';

// ---------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------

const GROUPING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function isSameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(dateStr, today.toISOString())) return 'Today';
  if (isSameDay(dateStr, yesterday.toISOString())) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

interface GroupedMessage {
  message: ChatMessage;
  showAvatar: boolean;
  showDateSeparator: boolean;
  dateLabel: string;
}

function groupMessages(messages: ChatMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    const showDateSeparator = !prev || !isSameDay(prev.createdAt, msg.createdAt);
    const dateLabel = showDateSeparator ? formatDateLabel(msg.createdAt) : '';

    let showAvatar = true;
    if (prev && !showDateSeparator) {
      const sameUser = prev.senderId === msg.senderId && prev.senderType === msg.senderType;
      const timeDiff = new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime();
      if (sameUser && timeDiff < GROUPING_THRESHOLD_MS) {
        showAvatar = false;
      }
    }

    result.push({ message: msg, showAvatar, showDateSeparator, dateLabel });
  }

  return result;
}

// ---------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 py-2 px-4 bg-background/95 backdrop-blur-sm">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs font-medium text-muted-foreground select-none whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function UnreadSeparator() {
  return (
    <div className="flex items-center gap-3 py-1 px-4">
      <div className="flex-1 h-px bg-primary/50" />
      <span className="text-xs font-medium text-primary select-none">New messages</span>
      <div className="flex-1 h-px bg-primary/50" />
    </div>
  );
}

function ChannelEmptyState({ channelName, description, isPrivate }: {
  channelName: string;
  description: string;
  isPrivate: boolean;
}) {
  const Icon = isPrivate ? Lock : Hash;

  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center max-w-md px-4">
        <Icon size={48} className="mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold text-foreground">
          This is the start of #{channelName}
        </p>
        <p className="text-sm mt-1">
          {description || 'Start connecting with your team.'}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// MessageList component
// ---------------------------------------------------------------

const SCROLL_THRESHOLD = 100;

interface MessageListProps {
  channelId?: string;
}

export function MessageList({ channelId: channelIdProp }: MessageListProps) {
  const dispatch = useAppDispatch();
  const activeChannelIdFromRedux = useAppSelector(selectActiveChannelId);
  const effectiveChannelId = channelIdProp ?? activeChannelIdFromRedux;
  const jumpToMessageId = useAppSelector(selectJumpToMessageId);

  const activeChannel = useAppSelector((state) =>
    state.chatChannels.channels.find((c) => c.id === effectiveChannelId),
  );
  const messages = useAppSelector((state) =>
    effectiveChannelId ? selectMessagesForChannel(state, effectiveChannelId) : [],
  );
  const unreadSeparatorId = useAppSelector((state) =>
    effectiveChannelId ? selectUnreadSeparatorForChannel(state, effectiveChannelId) : null,
  );
  // Tick counter to force typing users selector to re-evaluate expired entries
  const [, setTypingTick] = useState(0);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const typingUsers = useAppSelector((state) =>
    effectiveChannelId ? selectTypingUsers(state, effectiveChannelId) : [],
  ).filter(u => u.userId !== currentUserId);
  const hasMore = useAppSelector((state) =>
    effectiveChannelId ? selectHasMoreForChannel(state, effectiveChannelId) : false,
  );
  const isLoadingMore = useAppSelector((state) =>
    effectiveChannelId ? selectIsChannelLoading(state, effectiveChannelId) : false,
  );
  const loadingMoreRef = useRef(false);

  // Auto-expire typing indicators
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const timer = setInterval(() => setTypingTick(t => t + 1), 2000);
    return () => clearInterval(timer);
  }, [typingUsers.length]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);

  // Root-level messages only (no thread replies in the main list)
  const rootMessages = useMemo(
    () => messages.filter((m) => m.rootId === null),
    [messages],
  );

  const grouped = useMemo(() => groupMessages(rootMessages), [rootMessages]);

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setNewMessageCount(0);
  }, []);

  // Auto-scroll on mount / channel change
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveChannelId]);

  // Auto-scroll when new messages arrive (if near bottom)
  useEffect(() => {
    if (rootMessages.length > prevMessageCountRef.current) {
      if (isNearBottomRef.current) {
        requestAnimationFrame(scrollToBottom);
      } else {
        setNewMessageCount((c) => c + (rootMessages.length - prevMessageCountRef.current));
      }
    }
    prevMessageCountRef.current = rootMessages.length;
  }, [rootMessages.length, scrollToBottom]);

  // Jump to a specific message (from pinned, search, notifications)
  useEffect(() => {
    if (!jumpToMessageId || !scrollRef.current) return;

    // Check this message belongs to this channel's message list
    const messageExists = rootMessages.some(m => m.id === jumpToMessageId);
    if (!messageExists) return;

    // Find the DOM element and scroll to it
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-message-id="${jumpToMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(jumpToMessageId);
        // Clear highlight after 2 seconds
        setTimeout(() => setHighlightedId(null), 2000);
      }
      dispatch(clearJumpToMessage());
    });
  }, [jumpToMessageId, rootMessages, dispatch]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const nearBottom = checkNearBottom();
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setNewMessageCount(0);
    }

    // Load older messages when scrolled near top
    if (
      el.scrollTop < SCROLL_THRESHOLD &&
      hasMore &&
      !loadingMoreRef.current &&
      rootMessages.length > 0 &&
      effectiveChannelId
    ) {
      loadingMoreRef.current = true;
      const oldestId = rootMessages[0].id;
      const prevScrollHeight = el.scrollHeight;

      dispatch(fetchMessages({ channelId: effectiveChannelId, beforeId: oldestId }))
        .finally(() => {
          // Preserve scroll position after prepending
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              const newScrollHeight = scrollRef.current.scrollHeight;
              scrollRef.current.scrollTop += newScrollHeight - prevScrollHeight;
            }
            loadingMoreRef.current = false;
          });
        });
    }
  }, [checkNearBottom, hasMore, rootMessages, effectiveChannelId, dispatch]);

  if (!activeChannel) return null;

  const isPrivate = activeChannel.channelType === 'PRIVATE';

  if (rootMessages.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1">
          <ChannelEmptyState
            channelName={activeChannel.name}
            description={activeChannel.description}
            isPrivate={isPrivate}
          />
        </div>
        <TypingIndicator typingUsers={typingUsers} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {/* Loading older messages indicator */}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
          </div>
        )}

        {/* Top spacer */}
        <div className="pt-4" />

        {grouped.map((g) => (
          <div key={g.message.id} data-message-id={g.message.id}>
            {g.showDateSeparator && <DateSeparator label={g.dateLabel} />}
            {unreadSeparatorId === g.message.id && <UnreadSeparator />}
            <MessageItem
              message={g.message}
              isGrouped={!g.showAvatar}
              isFirstInGroup={g.showAvatar}
              isHighlighted={g.message.id === highlightedId}
            />
          </div>
        ))}

        {/* Bottom spacer */}
        <div className="pb-2" />
      </div>

      {/* New messages pill */}
      <NewMessagesPill count={newMessageCount} onClick={scrollToBottom} />

      {/* Typing indicator */}
      <TypingIndicator typingUsers={typingUsers} />
    </div>
  );
}
