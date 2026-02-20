/**
 * Confirm Dialog Component
 *
 * A styled confirmation dialog that replaces browser's native confirm().
 */

import { useEffect, useRef } from 'react';
import { Warning, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';

export interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
    loading?: boolean;
}

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirm Action',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    loading = false,
}: ConfirmDialogProps) {
    const confirmButtonRef = useRef<HTMLButtonElement>(null);

    // Focus confirm button when dialog opens
    useEffect(() => {
        if (isOpen) {
            // Small delay to ensure the dialog is rendered
            const timer = setTimeout(() => {
                confirmButtonRef.current?.focus();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Close on escape key
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape' && !loading) {
                onClose();
            }
        }
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [isOpen, loading, onClose]);

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: { backgroundColor: 'color-mix(in srgb, var(--status-error) 10%, transparent)', color: 'var(--status-error)' },
            buttonStyle: { backgroundColor: 'var(--status-error)', color: '#fff' },
            buttonHoverClass: 'hover:opacity-90',
            ringColor: 'var(--status-error)',
        },
        warning: {
            icon: { backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)', color: 'var(--status-warning)' },
            buttonStyle: { backgroundColor: 'var(--status-warning)', color: '#fff' },
            buttonHoverClass: 'hover:opacity-90',
            ringColor: 'var(--status-warning)',
        },
        default: {
            icon: {},
            buttonStyle: {},
            buttonHoverClass: '',
            ringColor: '',
        },
    };

    const styles = variantStyles[variant];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => !loading && onClose()}
            />

            {/* Dialog */}
            <div className="relative bg-card w-full max-w-md mx-4 rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-start gap-4 p-6 pb-4">
                    <div className={cn('p-3 rounded-full', variant === 'default' && 'bg-primary/10 text-primary')} style={styles.icon}>
                        <Warning size={24} weight="duotone" />
                    </div>
                    <div className="flex-1 pt-1">
                        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => !loading && onClose()}
                        disabled={loading}
                        className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
                    <Button
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={onClose}
                        disabled={loading}
                    >
                        {cancelLabel}
                    </Button>
                    <button
                        ref={confirmButtonRef}
                        type="button"
                        onClick={onConfirm}
                        disabled={loading}
                        className={cn(
                            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                            styles.buttonHoverClass,
                            variant === 'default' && 'bg-primary hover:bg-primary/90 text-primary-foreground focus:ring-primary'
                        )}
                        style={{
                            ...styles.buttonStyle,
                            ...(styles.ringColor ? { '--tw-ring-color': styles.ringColor } as React.CSSProperties : {}),
                        }}
                    >
                        {loading ? (
                            <span className="flex items-center gap-2">
                                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                Processing...
                            </span>
                        ) : (
                            confirmLabel
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

