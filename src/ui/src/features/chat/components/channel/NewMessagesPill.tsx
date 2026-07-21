import { ArrowDown } from '@phosphor-icons/react';

interface NewMessagesPillProps {
  /** Live messages that arrived while scrolled up; 0 while reading history. */
  count: number;
  /** Scrolled away from the bottom; renders a plain jump arrow when count is 0. */
  showJump: boolean;
  onClick: () => void;
}

export function NewMessagesPill({ count, showJump, onClick }: NewMessagesPillProps) {
  if (count === 0 && !showJump) return null;

  if (count === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Jump to latest messages"
        title="Jump to latest messages"
        className="absolute bottom-20 right-6 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground border border-border shadow-lg cursor-pointer hover:bg-accent transition-colors"
        data-testid="chat-jump-to-bottom"
      >
        <ArrowDown size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg cursor-pointer hover:bg-primary/90 transition-colors"
      data-testid="chat-new-messages-pill"
    >
      <ArrowDown size={14} />
      <span>
        {count} new message{count !== 1 ? 's' : ''}
      </span>
    </button>
  );
}
