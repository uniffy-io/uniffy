import { cn } from '@/shared/utils/cn';
import { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
import { formatTimeRemaining } from '@/shared/utils/dateFormatting';

interface CustomStatusDisplayProps {
    userId: string;
    className?: string;
}

/**
 * Inline display of a user's custom status (emoji + text + time remaining).
 * Returns null if no custom status is set or it has expired.
 */
export function CustomStatusDisplay({
    userId,
    className,
}: CustomStatusDisplayProps) {
    const customStatus = useCustomStatus(userId);

    if (!customStatus) return null;

    const remaining = formatTimeRemaining(customStatus.expiresAt);

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
