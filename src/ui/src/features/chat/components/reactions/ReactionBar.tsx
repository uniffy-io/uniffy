import { memo } from 'react';
import { Plus } from '@phosphor-icons/react';

import { cn } from '@/shared/utils/cn';

const EMOJI_UNICODE: Record<string, string> = {
  thumbs_up: '\u{1F44D}',
  thumbs_down: '\u{1F44E}',
  heart: '\u{2764}\u{FE0F}',
  fire: '\u{1F525}',
  eyes: '\u{1F440}',
  check: '\u{2705}',
  party: '\u{1F389}',
  laughing: '\u{1F602}',
  thinking: '\u{1F914}',
  clap: '\u{1F44F}',
  rocket: '\u{1F680}',
  wave: '\u{1F44B}',
  pray: '\u{1F64F}',
  bulb: '\u{1F4A1}',
  warning: '\u{26A0}\u{FE0F}',
};

function renderEmoji(key: string): string {
  return EMOJI_UNICODE[key] ?? key;
}

function buildTooltip(emoji: string, userIds: string[]): string {
  const count = userIds.length;
  const label = count === 1 ? '1 person' : `${count} people`;
  return `${renderEmoji(emoji)} ${label}`;
}

interface ReactionBarProps {
  reactions: {
    emoji: string;
    count: number;
    userIds: string[];
    hasCurrentUser: boolean;
  }[];
  onAddReaction?: () => void;
  onToggleReaction?: (emoji: string) => void;
}

function ReactionBarInner({
  reactions,
  onAddReaction,
  onToggleReaction,
}: ReactionBarProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1" data-testid="chat-reaction-bar">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs cursor-pointer transition-colors',
            reaction.hasCurrentUser
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border bg-muted/50 hover:bg-muted',
          )}
          title={buildTooltip(reaction.emoji, reaction.userIds)}
          onClick={() => onToggleReaction?.(reaction.emoji)}
          data-testid={`chat-reaction-${reaction.emoji}`}
          data-active={reaction.hasCurrentUser ? 'true' : 'false'}
          data-count={reaction.count}
        >
          <span className="text-[14px] leading-none">{renderEmoji(reaction.emoji)}</span>
          <span className="font-medium">{reaction.count}</span>
        </button>
      ))}
      <button
        className={cn(
          'inline-flex items-center justify-center px-1.5 py-0.5 rounded-full',
          'border border-dashed border-border hover:border-primary/50',
          'text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
        )}
        title="Add reaction"
        onClick={onAddReaction}
        data-testid="chat-reaction-add"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

export const ReactionBar = memo(ReactionBarInner);
