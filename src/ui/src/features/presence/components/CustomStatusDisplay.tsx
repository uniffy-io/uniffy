import { cn } from "@/shared/utils/cn";
import { useCustomStatus } from "@/features/presence/hooks/useCustomStatus";
import { formatTimeRemaining } from "@/shared/utils/dateFormatting";

interface CustomStatusDisplayProps {
  userId: string;
  className?: string;
  /** Emoji-only with text/time in the title tooltip. */
  compact?: boolean;
}

export function CustomStatusDisplay({
  userId,
  className,
  compact = false,
}: CustomStatusDisplayProps) {
  const customStatus = useCustomStatus(userId);

  if (!customStatus) return null;

  const remaining = formatTimeRemaining(customStatus.expiresAt);

  if (compact) {
    if (!customStatus.emoji) return null;
    const tooltip = remaining ? `${customStatus.text} ${remaining}`.trim() : customStatus.text;
    return (
      <span className={cn("shrink-0 leading-none", className)} title={tooltip} aria-label={tooltip}>
        {customStatus.emoji}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-muted-foreground text-sm truncate",
        className,
      )}
    >
      {customStatus.emoji && <span className="shrink-0">{customStatus.emoji}</span>}
      <span className="truncate">
        {customStatus.text}
        {remaining && <span className="text-subtle-foreground"> {remaining}</span>}
      </span>
    </span>
  );
}
