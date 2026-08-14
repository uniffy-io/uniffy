/** Virtualised message list; anchors via firstItemIndex shifts when older rows are prepended or oldest are evicted. */

import { useRef, useEffect, useCallback, useMemo, useState, type ReactNode } from "react";
import { Hash, Lock } from "@phosphor-icons/react";
import { Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";
import { useAvatarUrl } from "@/shared/hooks/useAvatarUrl";
import { getInitials } from "@/components/subject/utils";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { getPreferredTimeZone } from "@/shared/utils/timezone";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { selectActiveChannelId } from "@/features/chat/store/chatChannelsSlice";
import {
  selectMessagesForChannel,
  selectUnreadSeparatorForChannel,
  selectTypingUsers,
  selectHasMoreForChannel,
  selectIsChannelLoading,
  selectIsWindowedForChannel,
  evictOldestMessages,
  evictExpiredTyping,
} from "@/features/chat/store/chatMessagesSlice";
import { fetchMessages, stopAgentRun } from "@/features/chat/store/chatThunks";
import { selectJumpToMessageId, clearJumpToMessage } from "@/features/chat/store/chatUiSlice";
import { MessageItem } from "@/features/chat/components/channel/MessageItem";
import { TypingIndicator } from "@/features/chat/components/channel/TypingIndicator";
import { NewMessagesPill } from "@/features/chat/components/channel/NewMessagesPill";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import type { ChatMessage } from "@/features/chat/types";

const GROUPING_THRESHOLD_MS = 5 * 60 * 1000;
const START_INDEX = 100_000_000;
const EVICTION_THRESHOLD = 2000;
const EVICTION_DROP = 500;
// A freshly loaded window scrolls off estimated row heights, so the first scroll to a target
// lands short. Re-issue it while the rows around it measure, then release the bottom-pin.
const JUMP_SCROLL_ATTEMPTS = 8;
const JUMP_RETRY_MS = 120;

function dayKey(value: string | Date): string {
  return effectiveDayKey(typeof value === "string" ? new Date(value) : value);
}

function isSameDay(a: string, b: string): boolean {
  return dayKey(a) === dayKey(b);
}

function resolveMessageKind(message: ChatMessage): string {
  if (message.isDeleted) return "deleted";
  if (message.senderType === "SYSTEM") return "system";
  if (message.senderType === "AGENT") {
    if (message.metadata?.["kind"] === "context_reset") return "agent-context-reset";
    return "agent";
  }
  return "user";
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (dayKey(dateStr) === dayKey(today)) return "Today";
  if (dayKey(dateStr) === dayKey(yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    timeZone: getPreferredTimeZone() ?? undefined,
  });
}

interface GroupedMessage {
  message: ChatMessage;
  showAvatar: boolean;
  showDateSeparator: boolean;
  dateLabel: string;
  /** Present on a folded run of consecutive agent tool calls; rendered as one pane. */
  toolRun?: ChatMessage[];
}

function isAgentToolCall(m: ChatMessage): boolean {
  return m.senderType === "AGENT" && m.metadata?.["kind"] === "tool_call";
}

function groupMessages(messages: ChatMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    const showDateSeparator = !prev || !isSameDay(prev.createdAt, msg.createdAt);
    const dateLabel = showDateSeparator ? formatDateLabel(msg.createdAt) : "";

    let showAvatar = true;
    if (prev && !showDateSeparator) {
      const sameUser = prev.senderId === msg.senderId && prev.senderType === msg.senderType;
      const timeDiff = new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime();
      if (sameUser && timeDiff < GROUPING_THRESHOLD_MS) {
        showAvatar = false;
      }
    }

    if (isAgentToolCall(msg)) {
      const toolRun = [msg];
      let j = i + 1;
      while (
        j < messages.length &&
        isAgentToolCall(messages[j]) &&
        messages[j].senderId === msg.senderId
      ) {
        toolRun.push(messages[j]);
        j++;
      }
      result.push({ message: msg, showAvatar, showDateSeparator, dateLabel, toolRun });
      i = j - 1;
      continue;
    }

    result.push({ message: msg, showAvatar, showDateSeparator, dateLabel });
  }

  return result;
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-2 px-4"
      data-testid="chat-date-separator"
      data-date-label={label}
    >
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

function ChannelEmptyState({
  eyebrow,
  heading,
  description,
  accent,
}: {
  eyebrow: string;
  heading: string;
  description: string;
  accent: ReactNode;
}) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="flex flex-col items-center gap-4 text-center max-w-md px-4">
        <div
          className="hero-enter flex justify-center drop-shadow-[0_0_28px_rgba(105,74,255,0.35)]"
          style={{ animationFillMode: "backwards" }}
        >
          {accent}
        </div>
        <p
          className="hero-enter font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80"
          style={{ animationDelay: "80ms", animationFillMode: "backwards" }}
        >
          {eyebrow}
        </p>
        <p
          className="hero-enter text-2xl md:text-3xl font-medium tracking-tight text-foreground [text-wrap:balance]"
          style={{ animationDelay: "140ms", animationFillMode: "backwards" }}
        >
          {heading}
        </p>
        <p
          className="hero-enter text-sm"
          style={{ animationDelay: "200ms", animationFillMode: "backwards" }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

const HERO_AVATAR_BASE =
  "w-16 h-16 rounded-full ring-4 ring-background object-cover bg-primary/15 text-primary flex items-center justify-center text-xl font-medium shrink-0";

function HeroAvatar({
  userId,
  displayName,
  className,
}: {
  userId: string;
  displayName: string;
  className?: string;
}) {
  const avatarSrc = useAvatarUrl(userId, "lg");
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
      <HeroAvatar userId={peerId} displayName={peerName} className="-ml-5 scale-110 z-10" />
    </div>
  );
}

interface MessageListContext {
  hasMore: boolean;
  isLoadingMore: boolean;
}

// Constant header height while more history exists, so toggling the
// spinner never shifts the anchored rows below it.
function MessageListHeader({ context }: { context: MessageListContext }) {
  return context.hasMore ? (
    <div className="flex h-12 items-center justify-center">
      {context.isLoadingMore && (
        <>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
        </>
      )}
    </div>
  ) : (
    <div className="pt-4" />
  );
}

function MessageListFooter() {
  return <div className="pb-2" />;
}

const MESSAGE_LIST_COMPONENTS: Components<GroupedMessage, MessageListContext> = {
  Header: MessageListHeader,
  Footer: MessageListFooter,
};

interface MessageListProps {
  channelId?: string;
}

export function MessageList({ channelId: channelIdProp }: MessageListProps) {
  const dispatch = useAppDispatch();
  const activeChannelIdFromRedux = useAppSelector(selectActiveChannelId);
  const effectiveChannelId = channelIdProp ?? activeChannelIdFromRedux;
  const jumpToMessageId = useAppSelector(selectJumpToMessageId);

  const activeChannel = useAppSelector((state) =>
    effectiveChannelId ? state.chatChannels.byId[effectiveChannelId] : undefined,
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
    () => allTypingUsers.filter((u) => u.userId !== currentUserId),
    [allTypingUsers, currentUserId],
  );
  const hasMore = useAppSelector((state) =>
    effectiveChannelId ? selectHasMoreForChannel(state, effectiveChannelId) : false,
  );
  const isLoadingMore = useAppSelector((state) =>
    effectiveChannelId ? selectIsChannelLoading(state, effectiveChannelId) : false,
  );
  // A jump loads a window around its target, so the bottom of the list is not the live tail.
  const isWindowed = useAppSelector((state) =>
    effectiveChannelId ? selectIsWindowedForChannel(state, effectiveChannelId) : false,
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

  // Tool calls that already have a row absorb their result into the call card,
  // so the standalone result row is dropped from the list.
  const absorbedResultCallIds = useMemo(() => {
    const calls = new Set<string>();
    for (const m of messages) {
      if (m.senderType === "AGENT" && m.metadata?.["kind"] === "tool_call") {
        const cid = m.metadata?.["tool_call_id"];
        if (typeof cid === "string") calls.add(cid);
      }
    }
    return calls;
  }, [messages]);

  const rootMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (m.rootId !== null) return false;
        if (m.senderType === "AGENT" && m.metadata?.["kind"] === "tool_result") {
          const cid = m.metadata?.["tool_call_id"];
          if (typeof cid === "string" && absorbedResultCallIds.has(cid)) return false;
        }
        return true;
      }),
    [messages, absorbedResultCallIds],
  );

  const grouped = useMemo(() => groupMessages(rootMessages), [rootMessages]);

  const jumpIndex = useMemo(
    () => (jumpToMessageId ? grouped.findIndex((g) => g.message.id === jumpToMessageId) : -1),
    [jumpToMessageId, grouped],
  );

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevLenRef = useRef(grouped.length);
  const prevMessageCountRef = useRef(grouped.length);
  const prevLastIdRef = useRef<string | undefined>(undefined);
  const isAtBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Swapping between a jump window and the live tail replaces the whole list, so it remounts
  // the virtualiser rather than trying to anchor across two unrelated slices of history.
  const listKey = `${effectiveChannelId ?? "none"}:${isWindowed ? "window" : "live"}`;

  // Kept in a ref, and synced first, so the list-swap reset below can read it without
  // re-running on every jump.
  const jumpIndexRef = useRef(jumpIndex);
  useEffect(() => {
    jumpIndexRef.current = jumpIndex;
  }, [jumpIndex]);

  // Rows measure only once they render, and each measurement re-pins a list that reports itself
  // at the bottom - which walks the view straight back off a jump target. Hold that off until
  // the jump settles; the list reports its real position again afterwards.
  const jumpingRef = useRef(false);
  const jumpTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    // A list that opens on a jump target is not at its bottom, and claiming otherwise lets the
    // height-change pin below drag the view off the target while rows are still measuring.
    const opensOnJump = jumpIndexRef.current >= 0;
    // eslint-disable-next-line react/react-compiler -- per-channel reset on switch is intentional
    setFirstItemIndex(START_INDEX);
    prevFirstIdRef.current = undefined;
    prevLenRef.current = 0;
    prevMessageCountRef.current = 0;
    prevLastIdRef.current = undefined;
    setNewMessageCount(0);
    setHighlightedId(null);
    isAtBottomRef.current = !opensOnJump;
    setAtBottom(!opensOnJump);
  }, [listKey]);

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
    // Count only tail appends (live arrivals). History pagination prepends
    // grow the list too but leave the last id untouched - those are old
    // messages and must not feed the "new messages" pill.
    const lastId = grouped[grouped.length - 1]?.message.id;
    const grew = grouped.length - prevMessageCountRef.current;
    if (
      grew > 0 &&
      !isAtBottomRef.current &&
      prevLastIdRef.current !== undefined &&
      lastId !== prevLastIdRef.current
    ) {
      setNewMessageCount((c) => c + grew);
    }
    prevMessageCountRef.current = grouped.length;
    prevLastIdRef.current = lastId;
  }, [grouped]);

  useEffect(() => {
    if (!effectiveChannelId) return;
    if (grouped.length > EVICTION_THRESHOLD && isAtBottomRef.current) {
      dispatch(evictOldestMessages({ channelId: effectiveChannelId, count: EVICTION_DROP }));
    }
  }, [grouped.length, effectiveChannelId, dispatch]);

  useEffect(() => {
    // Target not loaded yet: the pending jump stays claimed so the window that loads it opens there.
    if (!jumpToMessageId || jumpIndex === -1) return;
    jumpingRef.current = true;
    if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);

    let attempt = 0;
    const scrollToTarget = () => {
      isAtBottomRef.current = false;
      virtuosoRef.current?.scrollToIndex({
        index: jumpIndex,
        align: "center",
        behavior: "auto",
      });
      attempt += 1;
      if (attempt < JUMP_SCROLL_ATTEMPTS) {
        jumpTimerRef.current = window.setTimeout(scrollToTarget, JUMP_RETRY_MS);
        return;
      }
      jumpingRef.current = false;
      jumpTimerRef.current = null;
    };

    requestAnimationFrame(() => {
      setAtBottom(false);
      scrollToTarget();
      setHighlightedId(jumpToMessageId);
    });
    dispatch(clearJumpToMessage());
  }, [jumpToMessageId, jumpIndex, dispatch]);

  const startReached = useCallback(() => {
    if (!effectiveChannelId || !hasMore || loadingMoreRef.current || rootMessages.length === 0)
      return;
    loadingMoreRef.current = true;
    const oldestId = rootMessages[0].id;
    dispatch(fetchMessages({ channelId: effectiveChannelId, beforeId: oldestId })).finally(() => {
      loadingMoreRef.current = false;
    });
  }, [effectiveChannelId, hasMore, rootMessages, dispatch]);

  const handleStopAgent = useCallback(
    (agentId: string) => {
      if (!effectiveChannelId) return;
      dispatch(stopAgentRun({ channelId: effectiveChannelId, agentId }));
    },
    [effectiveChannelId, dispatch],
  );

  const handleAtBottomChange = useCallback((bottom: boolean) => {
    // A jump in flight gets one stale "still at the bottom" report from the pre-scroll position.
    if (jumpingRef.current && bottom) return;
    isAtBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) {
      setNewMessageCount(0);
    }
  }, []);

  const handleTotalListHeightChanged = useCallback(() => {
    // A streaming reply grows the last row's height without adding an item, so
    // followOutput never re-fires. Re-pin to the bottom on every height change
    // while we're tracking it, so the view stays glued through the whole stream.
    if (jumpingRef.current) return;
    if (!isAtBottomRef.current) return;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  const scrollToBottom = useCallback(() => {
    // The newest messages are not in a jump window, so going live means refetching them.
    if (isWindowed && effectiveChannelId) {
      dispatch(fetchMessages({ channelId: effectiveChannelId }));
      return;
    }
    if (grouped.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: grouped.length - 1,
      align: "end",
      behavior: "smooth",
    });
  }, [grouped.length, isWindowed, effectiveChannelId, dispatch]);

  const listContext = useMemo<MessageListContext>(
    () => ({ hasMore, isLoadingMore }),
    [hasMore, isLoadingMore],
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
          toolRun={g.toolRun}
        />
      </div>
    ),
    [unreadSeparatorId, highlightedId],
  );

  const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? "");

  if (!activeChannel) return null;

  const isPrivate = activeChannel.channelType === "PRIVATE";
  const isDirect = activeChannel.channelType === "DIRECT";
  const isGroupDm = activeChannel.channelType === "GROUP_DM";
  const isDm = isDirect || isGroupDm;
  const peerNames = (() => {
    if (!isDm) return "";
    const raw = getChannelDisplayName(activeChannel);
    if (!currentUserName) return raw;
    const others = raw
      .split(",")
      .map((s) => s.trim())
      .filter((n) => n && n !== currentUserName);
    return others.length > 0 ? others.join(", ") : raw;
  })();
  const peerUserId = (() => {
    if (!isDirect) return "";
    return (activeChannel.dmMemberIds ?? []).find((id) => id && id !== (currentUserId ?? "")) ?? "";
  })();

  const heading = isDm
    ? `This is the start of your conversation with ${peerNames}`
    : `This is the start of #${getChannelDisplayName(activeChannel)}`;

  const eyebrow = isDirect
    ? "Private conversation"
    : isGroupDm
      ? "Group conversation"
      : isPrivate
        ? "Private channel"
        : "Team channel";

  const description = isDirect
    ? "Just the two of you. Say hello."
    : isGroupDm
      ? `Group conversation with ${activeChannel.memberCount} people.`
      : activeChannel.description || "Start connecting with your team.";

  const accent: ReactNode =
    isDirect && peerUserId ? (
      <DmPairAccent
        selfId={currentUserId ?? ""}
        selfName={currentUserName}
        peerId={peerUserId}
        peerName={peerNames}
      />
    ) : isPrivate ? (
      <Lock size={48} className="text-muted-foreground/30" />
    ) : (
      <Hash size={48} className="text-muted-foreground/30" />
    );

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
            eyebrow={eyebrow}
            heading={heading}
            description={description}
            accent={accent}
          />
        </div>
        <TypingIndicator typingUsers={typingUsers} onStopAgent={handleStopAgent} />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col relative min-h-0"
      data-testid="chat-message-list"
      data-empty="false"
    >
      <Virtuoso
        ref={virtuosoRef}
        key={listKey}
        className="flex-1"
        data={grouped}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={jumpIndex >= 0 ? jumpIndex : Math.max(0, grouped.length - 1)}
        followOutput={(isAtBottom) => (isAtBottom && !isWindowed ? "auto" : false)}
        startReached={startReached}
        atBottomStateChange={handleAtBottomChange}
        atBottomThreshold={100}
        totalListHeightChanged={handleTotalListHeightChanged}
        context={listContext}
        components={MESSAGE_LIST_COMPONENTS}
        itemContent={itemContent}
        computeItemKey={(_idx, g) => g.message.id}
      />

      <NewMessagesPill
        count={newMessageCount}
        showJump={!atBottom || isWindowed}
        onClick={scrollToBottom}
      />
      <TypingIndicator typingUsers={typingUsers} onStopAgent={handleStopAgent} />
    </div>
  );
}
