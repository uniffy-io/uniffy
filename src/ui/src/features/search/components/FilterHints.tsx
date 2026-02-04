/**
 * Filter Hints Component
 *
 * Displays available search filter syntax hints in the empty search state.
 */

import { FILTER_HINTS } from '@/features/search/utils/queryParser';
import { cn } from '@/shared/utils/cn';

interface FilterHintsProps {
    /** Callback when a filter hint is clicked */
    onHintClick?: (filter: string) => void;
    /** Additional CSS classes */
    className?: string;
}

/**
 * Shows available filter prefixes with examples.
 */
export function FilterHints({ onHintClick, className }: FilterHintsProps) {
    return (
        <div className={cn("flex flex-wrap gap-2 justify-center", className)}>
            {FILTER_HINTS.map((hint) => (
                <button
                    key={hint.prefix}
                    type="button"
                    onClick={() => onHintClick?.(hint.prefix)}
                    className={cn(
                        "px-2 py-1 rounded-md text-xs",
                        "bg-muted hover:bg-muted/80 text-muted-foreground",
                        "border border-border/50 hover:border-border",
                        "transition-colors cursor-pointer"
                    )}
                    title={`${hint.description} (e.g., ${hint.example})`}
                >
                    <span className="font-mono text-primary">{hint.prefix}</span>
                </button>
            ))}
        </div>
    );
}

/**
 * Compact version showing just the filter syntax inline.
 */
export function FilterHintsCompact({ className }: { className?: string }) {
    return (
        <div className={cn("text-xs text-muted-foreground/60", className)}>
            <span>Filters: </span>
            {FILTER_HINTS.slice(0, 4).map((hint, i) => (
                <span key={hint.prefix}>
                    <code className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[10px]">
                        {hint.prefix}
                    </code>
                    {i < 3 && <span className="mx-1">·</span>}
                </span>
            ))}
            <span className="mx-1">...</span>
        </div>
    );
}
