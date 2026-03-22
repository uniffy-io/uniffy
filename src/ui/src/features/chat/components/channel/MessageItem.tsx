import { useState, useCallback, useRef } from 'react';
import { PushPin, Robot } from '@phosphor-icons/react';

import { getMockUser, CURRENT_USER_ID, toSubject } from '@/features/chat/mock/mockMembers';
import { getGroupedReactions } from '@/features/chat/mock/mockReactions';
import { type ChatMessage } from '@/features/chat/mock/types';
import { HoverActionsToolbar } from '@/features/chat/components/channel/HoverActionsToolbar';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';
import { ThreadFooter } from '@/features/chat/components/channel/ThreadFooter';
import { ReactionBar } from '@/features/chat/components/reactions/ReactionBar';
import { EmojiPicker } from '@/features/chat/components/compose/EmojiPicker';
import { SubjectAvatar } from '@/components/subject';
import { cn } from '@/shared/utils/cn';

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
  const sender = getMockUser(message.senderId);
  const senderName = sender?.fullName ?? 'Unknown User';
  const senderSubject = toSubject(message.senderId);
  const hasThread = message.thread && message.thread.replyCount > 0;
  const isAgent = message.senderType === 'AGENT';

  // Local reactions state (merges mock data with user-added reactions)
  const [localReactions, setLocalReactions] = useState<Record<string, { userIds: string[] }>>({});
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const addReactionRef = useRef<HTMLDivElement>(null);

  const baseReactions = getGroupedReactions(message.id);

  // Merge mock reactions with locally added ones
  const reactions = baseReactions.map(r => {
    const local = localReactions[r.emoji];
    if (local) {
      const mergedUserIds = [...new Set([...r.userIds, ...local.userIds])];
      return {
        ...r,
        count: mergedUserIds.length,
        userIds: mergedUserIds,
        hasCurrentUser: mergedUserIds.includes(CURRENT_USER_ID),
      };
    }
    return r;
  });

  // Add reactions that only exist locally (not in mock data)
  for (const [emoji, data] of Object.entries(localReactions)) {
    if (!baseReactions.find(r => r.emoji === emoji)) {
      reactions.push({
        emoji,
        count: data.userIds.length,
        userIds: data.userIds,
        hasCurrentUser: data.userIds.includes(CURRENT_USER_ID),
      });
    }
  }

  const handleToggleReaction = useCallback((emoji: string) => {
    setLocalReactions(prev => {
      const existing = prev[emoji];
      if (existing && existing.userIds.includes(CURRENT_USER_ID)) {
        // Remove current user
        const filtered = existing.userIds.filter(id => id !== CURRENT_USER_ID);
        if (filtered.length === 0) {
          const next = { ...prev };
          delete next[emoji];
          return next;
        }
        return { ...prev, [emoji]: { userIds: filtered } };
      }
      // Add current user
      return {
        ...prev,
        [emoji]: { userIds: [...(existing?.userIds ?? []), CURRENT_USER_ID] },
      };
    });
  }, []);

  const handleAddReaction = useCallback((emoji: string) => {
    handleToggleReaction(emoji);
    setShowReactionPicker(false);
  }, [handleToggleReaction]);

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
      />

      <div className="flex items-start gap-3">
        {/* Avatar or hover timestamp */}
        {isFirstInGroup ? (
          <div className="shrink-0 mt-0.5">
            <SubjectAvatar subject={senderSubject} size="md" showPresence />
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
