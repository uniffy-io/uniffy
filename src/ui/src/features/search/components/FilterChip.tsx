import { X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface FilterChipProps {
    label: string;
    onRemove: () => void;
    icon?: React.ReactNode;
    variant?: 'default' | 'exact';
    className?: string;
}

export function FilterChip({ label, onRemove, icon, variant = 'default', className }: FilterChipProps) {
    const variantStyles = {
        default: {
            chip: "bg-primary/10 text-primary border-primary/20",
            button: "hover:bg-primary/20",
        },
        exact: {
            chip: "status-warning",
            button: "hover:opacity-80",
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
