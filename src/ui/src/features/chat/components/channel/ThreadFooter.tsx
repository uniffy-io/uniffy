import { CaretRight } from '@phosphor-icons/react';

import { useAppDispatch } from '@/app/hooks';
import { openThreadPanel } from '@/features/chat/store/chatUiSlice';
import { setActiveThread } from '@/features/chat/store/chatThreadsSlice';
import { SubjectAvatarStack } from '@/components/subject';
import { cn } from '@/shared/utils/cn';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';

interface ThreadFooterProps {
  rootMessageId: string;
  replyCount: number;
  lastReplyAt: string;
  participantIds: string[];
  hasUnread?: boolean;
}

export function ThreadFooter({
  rootMessageId,
  replyCount,
  lastReplyAt,
  participantIds,
  hasUnread = false,
}: ThreadFooterProps) {
  const dispatch = useAppDispatch();

  const handleClick = () => {
    dispatch(setActiveThread(rootMessageId));
    dispatch(openThreadPanel());
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 mt-1 px-2 py-1.5 rounded-lg',
        'hover:bg-muted/50 cursor-pointer transition-colors group/thread',
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Participant avatars */}
      <SubjectAvatarStack subjectIds={participantIds} size="xs" maxDisplay={4} />

      {/* Unread dot */}
      {hasUnread && (
        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
      )}

      {/* Reply count */}
      <span className="text-xs font-medium text-primary">
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </span>

      {/* Last reply time */}
      <span className="text-xs text-muted-foreground">
        Last reply {formatRelativeTime(lastReplyAt)}
      </span>

      {/* Arrow */}
      <CaretRight
        size={12}
        className="text-muted-foreground group-hover/thread:text-primary transition-colors ml-auto"
      />
    </div>
  );
}
