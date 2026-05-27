import { ArrowDown } from '@phosphor-icons/react';

interface NewMessagesPillProps {
  count: number;
  onClick: () => void;
}

export function NewMessagesPill({ count, onClick }: NewMessagesPillProps) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg cursor-pointer hover:bg-primary/90 transition-colors"
    >
      <ArrowDown size={14} />
      <span>
        {count} new message{count !== 1 ? 's' : ''}
      </span>
    </button>
  );
}
