/**
 * Filter Chip Component
 *
 * Displays an active search filter as a removable chip.
 */

import { X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface FilterChipProps {
    /** Filter label to display */
    label: string;
    /** Callback when remove button is clicked */
    onRemove: () => void;
    /** Optional icon to display before label */
    icon?: React.ReactNode;
    /** Visual variant for different filter types */
    variant?: 'default' | 'exact';
    /** Additional CSS classes */
    className?: string;
}

/**
 * A removable chip displaying an active filter.
 */
export function FilterChip({ label, onRemove, icon, variant = 'default', className }: FilterChipProps) {
    const variantStyles = {
        default: {
            chip: "bg-primary/10 text-primary border-primary/20",
            button: "hover:bg-primary/20",
        },
        exact: {
            chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            button: "hover:bg-amber-500/20",
        },
    };

    const styles = variantStyles[variant];

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
                "text-xs font-medium border",
                styles.chip,
                className
            )}
        >
            {icon}
            <span>{label}</span>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                className={cn("ml-0.5 p-0.5 rounded-full transition-colors", styles.button)}
                aria-label={`Remove ${label} filter`}
            >
                <X size={12} weight="bold" />
            </button>
        </span>
    );
}
