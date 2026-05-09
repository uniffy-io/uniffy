/**
 * Expanded Mention Card
 *
 * Renders the type-specific preview content inline as a block-level card.
 * Used as the default display for mention chips. Includes a collapse button
 * to shrink back to the compact inline chip.
 *
 * The card reuses the same preview components as the hover popover but
 * rendered inline in the content flow rather than in a fixed portal.
 */

import { useCallback, useMemo } from 'react';
import { CaretUp } from '@phosphor-icons/react';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import {
  TaskMentionPreview,
  CalendarMentionPreview,
  ProjectMentionPreview,
  FileMentionPreview,
  NoteMentionPreview,
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
  const glow = getContentTypeConfig(parsed.type).theme.glow;

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
      case UrnType.NOTE:
        return <NoteMentionPreview {...previewProps} />;
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
        'mention-expanded-card not-prose relative block',
        'w-80 my-2',
        'bg-card/95 backdrop-blur-xl',
        'text-card-foreground',
        'rounded-xl shadow-md',
        glow,
        'border border-border/50',
        'overflow-hidden',
        'cursor-pointer',
        'transition-all duration-200',
        'hover:shadow-lg',
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        onClick?.(e);
      }}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
    >
      {/* Collapse button */}
      <button
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onCollapse(); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title="Collapse to chip"
      >
        <CaretUp size={12} weight="bold" />
      </button>

      {renderPreview()}
    </span>
  );
}
