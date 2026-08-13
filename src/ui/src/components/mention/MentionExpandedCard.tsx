import { useCallback, useMemo } from 'react';
import { CaretUp } from '@phosphor-icons/react';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import {
  TaskMentionPreview,
  CalendarMentionPreview,
  ProjectMentionPreview,
  FileMentionPreview,
  FolderMentionPreview,
  NoteMentionPreview,
  RoomMentionPreview,
  UserMentionPreview,
  ChatMentionPreview,
  ChatMessageMentionPreview,
  AgentMentionPreview,
  TagMentionPreview,
} from '@/components/mention/previews';
import type { MentionLiveState } from '@/components/mention/types';
import { cn } from '@/shared/utils/cn';

interface MentionExpandedCardProps {
  urn: string;
  label: string;
  liveState: MentionLiveState;
  description?: string;
  onClick?: (e?: React.MouseEvent) => void;
  onCollapse: () => void;
  onEmbed?: () => void;
}

export function MentionExpandedCard({
  urn,
  label,
  liveState,
  description,
  onClick,
  onCollapse,
  onEmbed,
}: MentionExpandedCardProps) {
  const parsed = parseUrn(urn);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(urn);
  }, [urn]);

  const strippedDesc = useMemo(
    () => description ? stripMarkdown(description) : undefined,
    [description],
  );

  const previewProps = {
    urn,
    title: liveState.title || label,
    description: strippedDesc,
    liveState,
    onClose: onCollapse,
    onCopyLink: handleCopyLink,
  };

  function renderPreview() {
    switch (parsed.type) {
      case UrnType.TASK:
        return <TaskMentionPreview {...previewProps} />;
      case UrnType.CALENDAR_EVENT:
        return <CalendarMentionPreview {...previewProps} />;
      case UrnType.PROJECT:
        return <ProjectMentionPreview {...previewProps} />;
      case UrnType.FILE:
        return <FileMentionPreview {...previewProps} onEmbed={onEmbed} />;
      case UrnType.FOLDER:
        return <FolderMentionPreview {...previewProps} />;
      case UrnType.NOTE:
        return <NoteMentionPreview {...previewProps} />;
      case UrnType.ROOM:
        return <RoomMentionPreview {...previewProps} />;
      case UrnType.USER:
        return <UserMentionPreview {...previewProps} />;
      case UrnType.CHAT:
        return <ChatMentionPreview {...previewProps} />;
      case UrnType.CHAT_MESSAGE:
        return <ChatMessageMentionPreview {...previewProps} />;
      case UrnType.AGENT:
        return <AgentMentionPreview {...previewProps} />;
      case UrnType.TAG:
        return <TagMentionPreview {...previewProps} />;
      default:
        return null;
    }
  }

  return (
    <span
      className={cn(
        'mention-expanded-card not-prose group/card relative block',
        'w-full max-w-md my-2',
        'bg-card',
        'text-card-foreground',
        'rounded-lg shadow-xs',
        'border border-border',
        'overflow-hidden',
        'cursor-pointer',
        'transition-shadow duration-200',
        'hover:shadow-sm',
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        onClick?.(e);
      }}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
    >
      <button
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onCollapse(); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity"
        title="Collapse to chip"
      >
        <CaretUp size={12} weight="bold" />
      </button>

      {renderPreview()}
    </span>
  );
}
