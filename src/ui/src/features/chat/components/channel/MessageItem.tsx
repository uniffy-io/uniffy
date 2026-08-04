import { memo, useState, useCallback, useRef, useMemo } from 'react';
import { ArrowBendUpLeft, Lightning, PushPin, Robot, Stop } from '@phosphor-icons/react';

import { type ChatMessage } from '@/features/chat/types';
import { HoverActionsToolbar } from '@/features/chat/components/channel/HoverActionsToolbar';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';
import { SystemMessage } from '@/features/chat/components/channel/SystemMessage';
import { MessageAttachments } from '@/features/chat/components/channel/MessageAttachments';
import { ThreadFooter } from '@/features/chat/components/channel/ThreadFooter';
import { AgentMessageBody, AgentToolActivityPane } from '@/features/chat/components/channel/AgentMessageBody';
import { ReactionBar } from '@/features/chat/components/reactions/ReactionBar';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import { SubjectAvatarById, UserHoverCard } from '@/components/subject';
import { AgentAvatar } from '@/features/agents/components/AgentAvatar';
import { CustomStatusDisplay } from '@/features/presence/components/CustomStatusDisplay';
import { cn } from '@/shared/utils/cn';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { addReaction, removeReaction, jumpToChannelMessage } from '@/features/chat/store/chatThunks';
import { setReplyToMessage, setEditingMessage } from '@/features/chat/store/chatUiSlice';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatMessageTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = formatMessageTime(dateStr);

  if (msgDay.getTime() === today.getTime()) {
    return time;
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  }
  const dateLabel = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${dateLabel} ${time}`;
}

interface MessageItemProps {
  message: ChatMessage;
  isGrouped: boolean;
  isFirstInGroup: boolean;
  isHighlighted?: boolean;
  isSelected?: boolean;
  /** A folded run of consecutive agent tool calls rendered as one activity pane. */
  toolRun?: ChatMessage[];
}

function messageRev(m: ChatMessage): string {
  const meta = m.metadata as Record<string, unknown> | undefined;
  const seq = typeof meta?.streaming_sequence === 'number' ? meta.streaming_sequence : 0;
  const stopped = meta?.agent_run_stopped === 'true' || meta?.agent_run_stopped === true ? 1 : 0;
  const reactionsHash = m.reactions
    ? m.reactions.map(r => `${r.emoji}:${r.count}:${r.currentUserReacted ? 1 : 0}`).join(',')
    : '';
  const attachmentCount = m.attachments?.length ?? 0;
  const contentLen = m.content?.length ?? 0;
  const threadRev = m.thread
    ? `${m.thread.replyCount}:${m.thread.lastReplyAt ?? ''}:${m.thread.hasUnread ? 1 : 0}`
    : '';
  return `${m.id}|${m.updatedAt ?? ''}|${m.editedAt ?? ''}|${m.isDeleted ? 1 : 0}|${m.isPinned ? 1 : 0}|${contentLen}|${seq}|${stopped}|${reactionsHash}|${attachmentCount}|${threadRev}|${m.feedbackRating ?? ''}`;
}

function messageItemPropsAreEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.isGrouped !== next.isGrouped) return false;
  if (prev.isFirstInGroup !== next.isFirstInGroup) return false;
  if ((prev.isHighlighted ?? false) !== (next.isHighlighted ?? false)) return false;
  if ((prev.isSelected ?? false) !== (next.isSelected ?? false)) return false;
  // A growing tool run keeps the same representative message, so compare the run
  // membership and its last member; the pane reads result/typing state itself.
  const prevRun = prev.toolRun;
  const nextRun = next.toolRun;
  if ((prevRun?.length ?? 0) !== (nextRun?.length ?? 0)) return false;
  if (prevRun && nextRun && nextRun.length > 0) {
    if (messageRev(prevRun[prevRun.length - 1]) !== messageRev(nextRun[nextRun.length - 1])) return false;
  }
  return messageRev(prev.message) === messageRev(next.message);
}

function MessageItemInner({
  message,
  isGrouped,
  isFirstInGroup,
  isHighlighted = false,
  isSelected = false,
  toolRun,
}: MessageItemProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isAgent = message.senderType === 'AGENT';
  // A file referenced inline as a mention chip already represents itself; skip its
  // card so it shows once (the attachment record still rides along for access).
  const visibleAttachments = useMemo(
    () => (message.attachments ?? []).filter((att) => !message.content.includes(`FILE:${att.fileId}`)),
    [message.attachments, message.content],
  );
  // Set on the trigger message when the user stops the agent's reply mid-run.
  const agentRunStopped =
    message.metadata?.['agent_run_stopped'] === 'true' || message.metadata?.['agent_run_stopped'] === true;
  const invokedSkillName =
    !isAgent && typeof message.metadata?.['invoked_skill_name'] === 'string' && message.metadata['invoked_skill_name']
      ? (message.metadata['invoked_skill_name'] as string)
      : null;
  // Agent chats thread every turn off the previous message, so a quote on each
  // one is noise. Human DMs quote only when the sender picked a message, so the
  // quote carries real information there and stays visible.
  const isAgentDmChannel = useAppSelector(
    (state) => state.chatChannels.byId[message.channelId]?.isAgentDm === true,
  );
  const agent = useAppSelector((state) => state.agents.agents[message.senderId] ?? null);
  const senderName = (isAgent ? agent?.name : null) ?? message.senderName ?? (isAgent ? 'Agent' : 'Unknown User');
  const hasThread = message.thread && message.thread.replyCount > 0;

  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const addReactionRef = useRef<HTMLDivElement>(null);

  const [hoverCardVisible, setHoverCardVisible] = useState(false);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const showHoverCard = message.senderType === 'USER';

  const handleSenderMouseEnter = useCallback((e: React.MouseEvent) => {
    if (!showHoverCard) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverPosition({ x: rect.left, y: rect.bottom });
      setHoverCardVisible(true);
    }, 350);
  }, [showHoverCard]);

  const handleSenderMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverCardVisible(false);
    }, 350);
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    closeTimerRef.current = window.setTimeout(() => {
      setHoverCardVisible(false);
    }, 350);
  }, []);

  const reactions = (message.reactions ?? []).map(r => ({
    emoji: r.emoji,
    count: r.count,
    userIds: r.userIds,
    hasCurrentUser: r.currentUserReacted,
  }));

  const handleToggleReaction = useCallback((emoji: string) => {
    if (!currentUserId) return;
    const existing = reactions.find(r => r.emoji === emoji);
    if (existing?.hasCurrentUser) {
      dispatch(removeReaction({ channelId: message.channelId, messageId: message.id, emoji }));
    } else {
      dispatch(addReaction({ channelId: message.channelId, messageId: message.id, emoji }));
    }
  }, [currentUserId, reactions, dispatch, message.channelId, message.id]);

  const handleAddReaction = useCallback((emoji: string) => {
    dispatch(addReaction({ channelId: message.channelId, messageId: message.id, emoji }));
    setShowReactionPicker(false);
  }, [dispatch, message.channelId, message.id]);

  const handleQuoteReply = useCallback(() => {
    dispatch(setReplyToMessage({
      id: message.id,
      channelId: message.channelId,
      senderName,
      contentPreview: stripMarkdown(message.content).slice(0, 150),
    }));
  }, [dispatch, message.id, message.channelId, senderName, message.content]);

  const handleStartEdit = useCallback(() => {
    dispatch(setEditingMessage({
      id: message.id,
      channelId: message.channelId,
      content: message.content,
    }));
  }, [dispatch, message.id, message.channelId, message.content]);

  // Full-width context_reset dividers skip the bubble + avatar shell.
  if (message.senderType === 'AGENT' && message.metadata?.['kind'] === 'context_reset') {
    return (
      <div
        className="px-4 py-1"
        data-testid={`chat-message-${message.id}`}
        data-message-kind="agent-context-reset"
      >
        <AgentMessageBody message={message} />
      </div>
    );
  }

  if (message.senderType === 'SYSTEM') {
    return <SystemMessage content={message.content} messageId={message.id} />;
  }

  if (message.isDeleted) {
    return (
      <div
        className={cn(
          'group relative px-4 py-1',
          'hover:bg-muted/15 transition-colors',
        )}
        data-testid={`chat-message-${message.id}`}
        data-message-kind="deleted"
      >
        <div className="flex items-start gap-3">
          <div className="w-8 flex-shrink-0" />
          <span className="text-xs text-muted-foreground/50 italic">
            This message was deleted
          </span>
        </div>
      </div>
    );
  }

  // A folded run of tool calls renders as a single activity pane under the agent
  // shell, without the message chrome (reactions, threads, hover edit).
  if (toolRun && toolRun.length > 0) {
    return (
      <div
        className={cn('group relative px-4', isGrouped ? 'py-0.5' : 'py-1.5')}
        data-testid={`chat-message-${message.id}`}
        data-message-id={message.id}
        data-message-kind="agent-tool-run"
        data-sender-type={message.senderType}
        data-sender-id={message.senderId}
      >
        <div className="flex items-start gap-3">
          {isFirstInGroup ? (
            <div className="shrink-0 mt-0.5">
              <AgentAvatar
                avatarKey={agent?.avatarKey}
                avatarEmoji={agent?.avatarEmoji}
                agentName={senderName}
                size="md"
              />
            </div>
          ) : (
            <div className="w-8 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {isFirstInGroup && (
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-[13px] font-semibold text-foreground">{senderName}</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-full">
                  <Robot size={10} />
                  via Agent
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  {formatMessageTimestamp(message.createdAt)}
                </span>
              </div>
            )}
            <AgentToolActivityPane toolMessages={toolRun} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // No mount animation: the list is virtualized, so rows remount on every
        // scroll into view and a CSS entry animation replays each time.
        'group relative px-4',
        isGrouped ? 'py-0.5' : 'py-1.5',
        'hover:bg-muted/15 transition-colors',
        isSelected && 'bg-primary/5 border-l-2 border-primary',
        isHighlighted && 'bg-primary/10 border-l-2 border-primary',
        message.isPinned && !isHighlighted && 'border-l-2 border-primary/50 bg-primary/5',
      )}
      data-testid={`chat-message-${message.id}`}
      data-message-id={message.id}
      data-sender-type={message.senderType}
      data-sender-id={message.senderId}
      data-pinned={message.isPinned ? 'true' : 'false'}
      data-edited={message.editedAt ? 'true' : 'false'}
    >
      <HoverActionsToolbar
        messageId={message.id}
        channelId={message.channelId}
        senderId={message.senderId}
        isPinned={message.isPinned}
        content={message.content}
        onQuoteReply={handleQuoteReply}
        onEdit={handleStartEdit}
      />

      <div className="flex items-start gap-3">
        {isFirstInGroup ? (
          <div
            className="shrink-0 mt-0.5 cursor-pointer"
            onMouseEnter={handleSenderMouseEnter}
            onMouseLeave={handleSenderMouseLeave}
          >
            {isAgent ? (
              <AgentAvatar
                avatarKey={agent?.avatarKey}
                avatarEmoji={agent?.avatarEmoji}
                agentName={senderName}
                size="md"
              />
            ) : (
              <SubjectAvatarById
                userId={message.senderId}
                displayName={senderName}
                avatarUrl={message.senderAvatarUrl}
                size="md"
                showPresence
              />
            )}
          </div>
        ) : (
          <div className="w-8 flex-shrink-0 flex items-center justify-center">
            <span
              className={cn(
                'text-[10px] text-muted-foreground/50 whitespace-nowrap',
                'opacity-0 group-hover:opacity-100 transition-opacity',
              )}
            >
              {formatMessageTime(message.createdAt)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {isFirstInGroup && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span
                className="text-[13px] font-semibold text-foreground cursor-pointer hover:underline"
                onMouseEnter={handleSenderMouseEnter}
                onMouseLeave={handleSenderMouseLeave}
                data-testid={`chat-message-author-${message.id}`}
              >
                {senderName}
              </span>
              {isAgent && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-full"
                  data-testid={`chat-message-agent-badge-${message.id}`}
                >
                  <Robot size={10} />
                  via Agent
                </span>
              )}
              {!isAgent && (
                <CustomStatusDisplay
                  userId={message.senderId}
                  className="!text-[11px] max-w-[160px]"
                />
              )}
              <span
                className="text-[11px] text-muted-foreground/60"
                data-testid={`chat-message-timestamp-${message.id}`}
              >
                {formatMessageTimestamp(message.createdAt)}
              </span>
              {message.isPinned && (
                <PushPin size={12} className="text-muted-foreground" data-testid={`chat-message-pinned-icon-${message.id}`} />
              )}
            </div>
          )}

          {!isAgentDmChannel && message.replyContext && (
            <button
              type="button"
              className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer max-w-full"
              onClick={() =>
                dispatch(jumpToChannelMessage({
                  channelId: message.channelId,
                  messageId: message.replyContext!.id,
                }))
              }
            >
              <ArrowBendUpLeft size={12} className="shrink-0 text-primary/60" />
              <span className="font-semibold text-foreground/70 shrink-0">{message.replyContext.senderName}</span>
              <span className="truncate max-w-[340px] opacity-70 inline-flex items-center min-w-0">
                <MessageContent
                  content={message.replyContext.contentPreview}
                  compactMentions
                  className={cn(
                    '!text-xs !text-muted-foreground truncate',
                    '[&_*]:!text-xs [&_p]:!m-0 [&_p]:!inline',
                    '[&_.mention-chip-compact]:!py-0',
                  )}
                />
              </span>
            </button>
          )}

          {invokedSkillName && (
            <span
              className="mb-1 inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/30 px-1.5 py-0.5 text-[11px]"
              data-testid={`chat-message-skill-${message.id}`}
            >
              <Lightning size={11} weight="fill" className="text-primary" />
              <span className="font-mono text-foreground">/{invokedSkillName}</span>
            </span>
          )}
          <div data-testid={`chat-message-body-${message.id}`}>
            {isAgent ? (
              <AgentMessageBody message={message} />
            ) : (
              <MessageContent content={message.content} />
            )}
            {message.editedAt && (
              <span className="text-xs text-muted-foreground italic ml-1" data-testid={`chat-message-edited-marker-${message.id}`}>(edited)</span>
            )}
          </div>

          {agentRunStopped && (
            <div
              className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
              data-testid={`chat-message-stopped-${message.id}`}
            >
              <Stop size={10} weight="fill" />
              Response stopped
            </div>
          )}

          {visibleAttachments.length > 0 && organizationId && (
            <MessageAttachments attachments={visibleAttachments} organizationId={organizationId} />
          )}

          <div ref={addReactionRef}>
            {(reactions.length > 0 || showReactionPicker) && (
              <ReactionBar
                reactions={reactions}
                onToggleReaction={handleToggleReaction}
                onAddReaction={() => setShowReactionPicker(true)}
              />
            )}
            {showReactionPicker && (
              <EmojiPicker
                anchorRef={addReactionRef}
                onSelect={handleAddReaction}
                onClose={() => setShowReactionPicker(false)}
              />
            )}
          </div>

          {hasThread && message.thread && (
            <ThreadFooter
              rootMessageId={message.id}
              replyCount={message.thread.replyCount}
              lastReplyAt={message.thread.lastReplyAt}
              participantIds={message.thread.participantIds}
              hasUnread={message.thread.hasUnread}
            />
          )}
        </div>
      </div>

      {showHoverCard && (
        <UserHoverCard
          userId={message.senderId}
          displayName={senderName}
          position={hoverPosition}
          isVisible={hoverCardVisible}
          onClose={() => setHoverCardVisible(false)}
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
        />
      )}
    </div>
  );
}

export const MessageItem = memo(MessageItemInner, messageItemPropsAreEqual);
