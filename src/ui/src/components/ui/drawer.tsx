import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    side?: 'left' | 'right';
    /** Default `w-80` (320px). */
    className?: string;
    showClose?: boolean;
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
            <div
                className={cn(
                    'fixed inset-0 bg-black/40 transition-opacity duration-300',
                    open ? 'opacity-100' : 'opacity-0'
                )}
                onClick={onClose}
            />

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
                    !className?.includes('w-') && 'w-80',
                    className
                )}
            >
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
