/**
 * Drawer component for slide-over panels on tablet/mobile.
 *
 * Used to show sidebars and detail panels as overlays on smaller screens.
 * Supports left (sidebars) and right (detail panels) sides with backdrop.
 */

import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** Which side the drawer slides in from */
    side?: 'left' | 'right';
    /** Width class (Tailwind). Defaults to 'w-80' (320px) */
    className?: string;
    /** Show close button in top corner */
    showClose?: boolean;
    /** Accessible label */
    ariaLabel?: string;
}

export function Drawer({
    open,
    onClose,
    children,
    side = 'left',
    className,
    showClose = true,
    ariaLabel,
}: DrawerProps) {
    const drawerRef = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        if (!open) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    // Prevent body scroll when open
    useEffect(() => {
        if (!open) return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [open]);

    if (!open) return null;

    const isLeft = side === 'left';

    return (
        <div
            className="fixed inset-0 z-50 flex"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
        >
            {/* Backdrop */}
            <div
                className={cn(
                    'fixed inset-0 bg-black/40 transition-opacity duration-300',
                    open ? 'opacity-100' : 'opacity-0'
                )}
                onClick={onClose}
            />

            {/* Drawer panel */}
            <div
                ref={drawerRef}
                className={cn(
                    'relative z-50 flex flex-col h-full bg-card border-border overflow-y-auto',
                    'transition-transform duration-300 ease-out',
                    isLeft ? 'border-r' : 'ml-auto border-l',
                    open
                        ? 'translate-x-0'
                        : isLeft
                            ? '-translate-x-full'
                            : 'translate-x-full',
                    // Default width if not overridden
                    !className?.includes('w-') && 'w-80',
                    className
                )}
            >
                {/* Close button */}
                {showClose && (
                    <button
                        onClick={onClose}
                        className={cn(
                            'absolute top-3 z-10 p-1.5 rounded-md',
                            'text-muted-foreground hover:text-foreground hover:bg-muted',
                            'transition-colors',
                            isLeft ? 'right-2' : 'left-2'
                        )}
                        aria-label="Close"
                    >
                        <X size={16} weight="bold" />
                    </button>
                )}

                {children}
            </div>
        </div>
    );
}
