import { useState, useCallback, useRef } from 'react';
import { ArrowBendUpLeft, PushPin, Robot } from '@phosphor-icons/react';

import { type ChatMessage } from '@/features/chat/types';
import { HoverActionsToolbar } from '@/features/chat/components/channel/HoverActionsToolbar';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';
import { ThreadFooter } from '@/features/chat/components/channel/ThreadFooter';
import { ReactionBar } from '@/features/chat/components/reactions/ReactionBar';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import { SubjectAvatarById } from '@/components/subject';
import { cn } from '@/shared/utils/cn';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { addReaction, removeReaction } from '@/features/chat/store/chatThunks';
import { setReplyToMessage, jumpToMessage } from '@/features/chat/store/chatUiSlice';
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
}

export function MessageItem({
  message,
  isGrouped,
  isFirstInGroup,
  isHighlighted = false,
  isSelected = false,
}: MessageItemProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const senderName = message.senderName ?? 'Unknown User';
  const hasThread = message.thread && message.thread.replyCount > 0;
  const isAgent = message.senderType === 'AGENT';

  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const addReactionRef = useRef<HTMLDivElement>(null);

  // Use reactions from API data
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

  // System message (join, leave, etc.)
  if (message.senderType === 'SYSTEM') {
    return (
      <div className="flex justify-center py-2 px-4">
        <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MessageContent content={message.content} className="!text-xs !text-muted-foreground [&_*]:!text-xs [&_.mention-chip-compact]:!text-[10px]" />
        </div>
      </div>
    );
  }

  // Deleted message
  if (message.isDeleted) {
    return (
      <div
        className={cn(
          'group relative px-4 py-1',
          'hover:bg-muted/30 transition-colors',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="w-8 flex-shrink-0" />
          <span className="text-sm text-muted-foreground italic">
            This message was deleted
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bubble-enter group relative px-4',
        isGrouped ? 'py-0.5' : 'py-1.5',
        'hover:bg-muted/30 transition-colors',
        isSelected && 'bg-primary/5 border-l-2 border-primary',
        isHighlighted && 'bg-primary/10 transition-[background-color] duration-1000',
        message.isPinned && !isHighlighted && 'border-l-2 border-primary/50 bg-primary/10',
      )}
    >
      <HoverActionsToolbar
        messageId={message.id}
        channelId={message.channelId}
        senderId={message.senderId}
        isPinned={message.isPinned}
        content={message.content}
        onQuoteReply={handleQuoteReply}
      />

      <div className="flex items-start gap-3">
        {/* Avatar or hover timestamp */}
        {isFirstInGroup ? (
          <div className="shrink-0 mt-0.5">
            <SubjectAvatarById userId={message.senderId} displayName={senderName} size="md" showPresence />
          </div>
        ) : (
          <div className="w-8 flex-shrink-0 flex items-center justify-center">
            <span
              className={cn(
                'text-[10px] text-muted-foreground whitespace-nowrap',
                'opacity-0 group-hover:opacity-100 transition-opacity',
              )}
            >
              {formatMessageTime(message.createdAt)}
            </span>
          </div>
        )}

        {/* Content column */}
        <div className="min-w-0 flex-1">
          {/* Header: name + timestamp (only on first in group) */}
          {isFirstInGroup && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-sm font-semibold text-foreground">
                {senderName}
              </span>
              {isAgent && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  <Robot size={10} />
                  via Agent
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatMessageTimestamp(message.createdAt)}
              </span>
              {message.isPinned && (
                <PushPin size={12} className="text-muted-foreground" />
              )}
            </div>
          )}

          {/* Inline reply preview */}
          {message.replyContext && (
            <button
              type="button"
              className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={() => dispatch(jumpToMessage(message.replyContext!.id))}
            >
              <ArrowBendUpLeft size={12} className="shrink-0 text-primary/60" />
              <span className="font-semibold text-foreground/70">{message.replyContext.senderName}</span>
              <span className="truncate max-w-[300px] opacity-70">{message.replyContext.contentPreview}</span>
            </button>
          )}

          {/* Message text */}
          <div>
            <MessageContent content={message.content} />
            {message.editedAt && (
              <span className="text-xs text-muted-foreground italic ml-1">(edited)</span>
            )}
          </div>

          {/* Reactions */}
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

          {/* Thread footer */}
          {hasThread && message.thread && (
            <ThreadFooter
              rootMessageId={message.id}
              replyCount={message.thread.replyCount}
              lastReplyAt={message.thread.lastReplyAt}
              participantIds={message.thread.participantIds}
              hasUnread={message.thread.replyCount > 3}
            />
          )}
        </div>
      </div>
    </div>
  );
}
