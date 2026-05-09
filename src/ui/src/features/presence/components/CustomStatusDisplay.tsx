import { cn } from '@/shared/utils/cn';
import { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
import { formatTimeRemaining } from '@/shared/utils/dateFormatting';

interface CustomStatusDisplayProps {
    userId: string;
    className?: string;
    /**
     * Compact mode shows only the emoji with the text/time exposed via the
     * native title tooltip. Intended for tight rows like sidebar entries
     * and message headers where horizontal space is at a premium.
     */
    compact?: boolean;
}

/**
 * Inline display of a user's custom status (emoji + text + time remaining).
 * Returns null if no custom status is set or it has expired.
 */
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
        const tooltip = remaining
            ? `${customStatus.text} ${remaining}`.trim()
            : customStatus.text;
        return (
            <span
                className={cn(
                    'shrink-0 leading-none',
                    className,
                )}
                title={tooltip}
                aria-label={tooltip}
            >
                {customStatus.emoji}
            </span>
        );
    }

    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 text-muted-foreground text-sm truncate',
                className,
            )}
        >
            {customStatus.emoji && (
                <span className="shrink-0">{customStatus.emoji}</span>
            )}
            <span className="truncate">
                {customStatus.text}
                {remaining && (
                    <span className="text-muted-foreground/60"> {remaining}</span>
                )}
            </span>
        </span>
    );
}
