/**
 * Search input for filtering notifications within the panel.
 *
 * Provides a compact search field with clear button,
 * styled to match the SpotlightSearch input pattern.
 */

import { useRef, useCallback } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface NotificationSearchProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export function NotificationSearch({
    value,
    onChange,
    placeholder = 'Search notifications...',
    className,
}: NotificationSearchProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleClear = useCallback(() => {
        onChange('');
        inputRef.current?.focus();
    }, [onChange]);

    return (
        <div className={cn('relative', className)}>
            <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
            />
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'w-full h-8 pl-8 pr-8 rounded-md text-xs',
                    'bg-muted/50 border border-border/50',
                    'text-foreground placeholder:text-muted-foreground/50',
                    'focus:outline-none focus:ring-1 focus:ring-ring focus:border-border',
                    'transition-colors'
                )}
            />
            {value && (
                <button
                    onClick={handleClear}
                    className={cn(
                        'absolute right-2 top-1/2 -translate-y-1/2',
                        'p-0.5 rounded text-muted-foreground/60',
                        'hover:text-foreground transition-colors'
                    )}
                >
                    <X size={12} weight="bold" />
                </button>
            )}
        </div>
    );
}
