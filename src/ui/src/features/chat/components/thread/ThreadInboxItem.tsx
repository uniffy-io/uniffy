/**
 * ThreadInboxItem - Single thread entry in the Threads Inbox.
 *
 * Shows channel name, root message preview, reply count, last reply time,
 * and unread indicator.
 */

import { ChatText, Hash } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { SubjectAvatarById } from '@/components/subject';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { type ThreadInboxItem as ThreadInboxItemType } from '@/features/chat/types';

interface ThreadInboxItemProps {
  thread: ThreadInboxItemType;
  onClick: () => void;
}

export function ThreadInboxItem({ thread, onClick }: ThreadInboxItemProps) {
  const senderName = thread.rootMessageSenderName ?? 'Unknown';

  // Truncate root message content for preview
  const preview = thread.rootMessageContent.length > 120
    ? thread.rootMessageContent.slice(0, 120) + '...'
    : thread.rootMessageContent;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors",
        thread.hasUnread && "bg-primary/5"
      )}
    >
      {/* Channel name */}
      <div className="flex items-center gap-1.5 mb-1">
        <Hash size={12} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">
          {thread.channelName}
        </span>
        {thread.hasUnread && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 ml-auto" />
        )}
      </div>

      {/* Root message preview */}
      <div className="flex items-start gap-2 mb-1.5">
        <div className="shrink-0 mt-0.5">
          <SubjectAvatarById userId={thread.rootMessageSenderId} displayName={senderName} size="xs" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-foreground">{senderName}</span>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
            {preview}
          </p>
        </div>
      </div>

      {/* Reply info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ChatText size={12} />
        <span className="font-medium text-primary">
          {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
        </span>
        <span>Last reply {formatRelativeTime(thread.lastReplyAt)}</span>
      </div>
    </button>
  );
}
