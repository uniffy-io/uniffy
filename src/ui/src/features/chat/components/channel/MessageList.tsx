/**
 * MessageList - Main scrollable message list for a channel.
 *
 * Virtualised via react-virtuoso. The Virtuoso instance owns scroll
 * position, follow-output sticky-bottom, and on-demand row mounting.
 * Older messages load via startReached; the list anchors via
 * firstItemIndex shifts when older rows are prepended or oldest rows
 * are evicted.
 */

import { useRef, useEffect, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Hash, Lock } from '@phosphor-icons/react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { getInitials } from '@/components/subject/utils';
import { cn } from '@/shared/utils/cn';
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
  evictOldestMessages,
  evictExpiredTyping,
} from '@/features/chat/store/chatMessagesSlice';
import { fetchMessages } from '@/features/chat/store/chatThunks';
import {
  selectJumpToMessageId,
  clearJumpToMessage,
} from '@/features/chat/store/chatUiSlice';
import { MessageItem } from '@/features/chat/components/channel/MessageItem';
import { TypingIndicator } from '@/features/chat/components/channel/TypingIndicator';
import { NewMessagesPill } from '@/features/chat/components/channel/NewMessagesPill';
import { getChannelDisplayName } from '@/features/chat/utils/channelDisplay';
import type { ChatMessage } from '@/features/chat/types';

const GROUPING_THRESHOLD_MS = 5 * 60 * 1000;
const START_INDEX = 100_000_000;
const EVICTION_THRESHOLD = 2000;
const EVICTION_DROP = 500;

function isSameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function resolveMessageKind(message: ChatMessage): string {
  if (message.isDeleted) return 'deleted';
  if (message.senderType === 'SYSTEM') return 'system';
  if (message.senderType === 'AGENT') {
    if (message.metadata?.['kind'] === 'context_reset') return 'agent-context-reset';
    return 'agent';
  }
  return 'user';
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

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4" data-testid="chat-date-separator" data-date-label={label}>
      <div className="flex-1 h-px bg-border/30" />
      <span className="text-xs font-medium text-muted-foreground/60 select-none whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

function UnreadSeparator() {
  return (
    <div className="flex items-center gap-3 py-1 px-4" data-testid="chat-unread-separator">
      <div className="flex-1 h-px bg-primary/50" />
      <span className="text-xs font-medium text-primary select-none">New messages</span>
      <div className="flex-1 h-px bg-primary/50" />
    </div>
  );
}

function ChannelEmptyState({ heading, description, accent }: {
  heading: string;
  description: string;
  accent: ReactNode;
}) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center max-w-md px-4">
        <div className="mb-4 flex justify-center">{accent}</div>
        <p className="text-lg font-semibold text-foreground">
          {heading}
        </p>
        <p className="text-sm mt-1">
          {description}
        </p>
      </div>
    </div>
  );
}

const HERO_AVATAR_BASE =
  'w-16 h-16 rounded-full ring-4 ring-background object-cover bg-primary/15 text-primary flex items-center justify-center text-xl font-medium shrink-0';

function HeroAvatar({
  userId,
  displayName,
  className,
}: {
  userId: string;
  displayName: string;
  className?: string;
}) {
  const avatarSrc = useAvatarUrl(userId, 'md');
  const [failed, setFailed] = useState(false);
  if (avatarSrc && !failed) {
    return (
      <img
        src={avatarSrc}
        alt={displayName}
        className={cn(HERO_AVATAR_BASE, className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={cn(HERO_AVATAR_BASE, className)} title={displayName}>
      {getInitials(displayName || userId.slice(-2).toUpperCase())}
    </div>
  );
}

function DmPairAccent({
  selfId,
  selfName,
  peerId,
  peerName,
}: {
  selfId: string;
  selfName: string;
  peerId: string;
  peerName: string;
}) {
  return (
    <div className="relative inline-flex items-center" aria-hidden="true">
      <HeroAvatar userId={selfId} displayName={selfName} className="opacity-90" />
      <HeroAvatar
        userId={peerId}
        displayName={peerName}
        className="-ml-5 scale-110 z-10"
      />
    </div>
  );
}

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
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const allTypingUsers = useAppSelector((state) =>
    effectiveChannelId ? selectTypingUsers(state, effectiveChannelId) : [],
  );
  const typingUsers = useMemo(
    () => allTypingUsers.filter(u => u.userId !== currentUserId),
    [allTypingUsers, currentUserId],
  );
  const hasMore = useAppSelector((state) =>
    effectiveChannelId ? selectHasMoreForChannel(state, effectiveChannelId) : false,
  );
  const isLoadingMore = useAppSelector((state) =>
    effectiveChannelId ? selectIsChannelLoading(state, effectiveChannelId) : false,
  );
  const hasLoaded = useAppSelector((state) =>
    effectiveChannelId ? state.chatMessages.idsByChannel[effectiveChannelId] !== undefined : false,
  );
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!effectiveChannelId || typingUsers.length === 0) return;
    const timer = setInterval(() => {
      dispatch(evictExpiredTyping({ channelId: effectiveChannelId }));
    }, 2000);
    return () => clearInterval(timer);
  }, [dispatch, effectiveChannelId, typingUsers.length]);

  const rootMessages = useMemo(
    () => messages.filter((m) => m.rootId === null),
    [messages],
  );

  const grouped = useMemo(() => groupMessages(rootMessages), [rootMessages]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevLenRef = useRef(grouped.length);
  const prevMessageCountRef = useRef(grouped.length);
  const isAtBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- per-channel reset on switch is intentional */
    setFirstItemIndex(START_INDEX);
    prevFirstIdRef.current = undefined;
    prevLenRef.current = 0;
    prevMessageCountRef.current = 0;
    setNewMessageCount(0);
    setHighlightedId(null);
    isAtBottomRef.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [effectiveChannelId]);

  useEffect(() => {
    const firstId = grouped[0]?.message.id;
    if (prevFirstIdRef.current !== undefined && firstId !== prevFirstIdRef.current) {
      const delta = grouped.length - prevLenRef.current;
      if (delta !== 0) {
        setFirstItemIndex((idx) => idx - delta);
      }
    }
    prevFirstIdRef.current = firstId;
    prevLenRef.current = grouped.length;
  }, [grouped]);

  useEffect(() => {
    const grew = grouped.length - prevMessageCountRef.current;
    if (grew > 0 && !isAtBottomRef.current) {
      setNewMessageCount((c) => c + grew);
    }
    prevMessageCountRef.current = grouped.length;
  }, [grouped.length]);

  useEffect(() => {
    if (!effectiveChannelId) return;
    if (grouped.length > EVICTION_THRESHOLD && isAtBottomRef.current) {
      dispatch(evictOldestMessages({ channelId: effectiveChannelId, count: EVICTION_DROP }));
    }
  }, [grouped.length, effectiveChannelId, dispatch]);

  useEffect(() => {
    if (!jumpToMessageId) return;
    const idx = grouped.findIndex((g) => g.message.id === jumpToMessageId);
    if (idx === -1) return;
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: idx,
        align: 'center',
        behavior: 'smooth',
      });
      setHighlightedId(jumpToMessageId);
    });
    dispatch(clearJumpToMessage());
  }, [jumpToMessageId, grouped, dispatch]);

  const startReached = useCallback(() => {
    if (
      !effectiveChannelId ||
      !hasMore ||
      loadingMoreRef.current ||
      rootMessages.length === 0
    ) return;
    loadingMoreRef.current = true;
    const oldestId = rootMessages[0].id;
    dispatch(fetchMessages({ channelId: effectiveChannelId, beforeId: oldestId }))
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [effectiveChannelId, hasMore, rootMessages, dispatch]);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setNewMessageCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (grouped.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: grouped.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
  }, [grouped.length]);

  const components = useMemo(
    () => ({
      Header: () =>
        isLoadingMore ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
          </div>
        ) : (
          <div className="pt-4" />
        ),
      Footer: () => <div className="pb-2" />,
    }),
    [isLoadingMore],
  );

  const itemContent = useCallback(
    (_idx: number, g: GroupedMessage) => (
      <div
        data-message-id={g.message.id}
        data-testid={`chat-message-row-${g.message.id}`}
        data-message-kind={resolveMessageKind(g.message)}
      >
        {g.showDateSeparator && <DateSeparator label={g.dateLabel} />}
        {unreadSeparatorId === g.message.id && <UnreadSeparator />}
        <MessageItem
          message={g.message}
          isGrouped={!g.showAvatar}
          isFirstInGroup={g.showAvatar}
          isHighlighted={g.message.id === highlightedId}
        />
      </div>
    ),
    [unreadSeparatorId, highlightedId],
  );

  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? '');

  if (!activeChannel) return null;

  const isPrivate = activeChannel.channelType === 'PRIVATE';
  const isDirect = activeChannel.channelType === 'DIRECT';
  const isGroupDm = activeChannel.channelType === 'GROUP_DM';
  const isDm = isDirect || isGroupDm;
  const peerNames = (() => {
    if (!isDm) return '';
    const raw = getChannelDisplayName(activeChannel);
    if (!currentUserName) return raw;
    const others = raw
      .split(',')
      .map((s) => s.trim())
      .filter((n) => n && n !== currentUserName);
    return others.length > 0 ? others.join(', ') : raw;
  })();
  const peerUserId = (() => {
    if (!isDirect) return '';
    return (activeChannel.dmMemberIds ?? []).find((id) => id && id !== (currentUserId ?? '')) ?? '';
  })();

  const heading = isDm
    ? `This is the start of your conversation with ${peerNames}`
    : `This is the start of #${getChannelDisplayName(activeChannel)}`;

  const description = isDirect
    ? 'Just the two of you. Say hello.'
    : isGroupDm
      ? `Group conversation with ${activeChannel.memberCount} people.`
      : activeChannel.description || 'Start connecting with your team.';

  const accent: ReactNode = isDirect && peerUserId
    ? (
      <DmPairAccent
        selfId={currentUserId ?? ''}
        selfName={currentUserName}
        peerId={peerUserId}
        peerName={peerNames}
      />
    )
    : isPrivate
      ? <Lock size={48} className="text-muted-foreground/30" />
      : <Hash size={48} className="text-muted-foreground/30" />;

  if (rootMessages.length === 0) {
    if (!hasLoaded || isLoadingMore) {
      return (
        <div
          className="flex-1 flex items-center justify-center"
          data-testid="chat-message-list"
          data-loading="true"
        >
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col" data-testid="chat-message-list" data-empty="true">
        <div className="flex-1">
          <ChannelEmptyState
            heading={heading}
            description={description}
            accent={accent}
          />
        </div>
        <TypingIndicator typingUsers={typingUsers} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative min-h-0" data-testid="chat-message-list" data-empty="false">
      <Virtuoso
        ref={virtuosoRef}
        key={effectiveChannelId}
        className="flex-1"
        data={grouped}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, grouped.length - 1)}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        startReached={startReached}
        atBottomStateChange={handleAtBottomChange}
        atBottomThreshold={100}
        components={components}
        itemContent={itemContent}
        computeItemKey={(_idx, g) => g.message.id}
      />

      <NewMessagesPill count={newMessageCount} onClick={scrollToBottom} />
      <TypingIndicator typingUsers={typingUsers} />
    </div>
  );
}
