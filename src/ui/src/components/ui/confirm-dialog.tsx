/**
 * Confirm Dialog Component
 *
 * A styled confirmation dialog that replaces browser's native confirm().
 */

import { useEffect, useRef } from 'react';
import { Warning, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/shared/utils/cn';

export interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    message: React.ReactNode;
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

    if (!isOpen) return null;

    const iconStyles = {
        danger: { backgroundColor: 'color-mix(in srgb, var(--status-error) 10%, transparent)', color: 'var(--status-error)' },
        warning: { backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)', color: 'var(--status-warning)' },
        default: {},
    };

    return (
        <Modal onClose={onClose} closeDisabled={loading} maxWidth="max-w-md">
            <div data-testid="confirm-dialog" data-variant={variant}>
            {/* Header */}
            <div className="flex items-start gap-4 p-6 pb-4">
                <div className={cn('p-3 rounded-full', variant === 'default' && 'bg-primary/10 text-primary')} style={iconStyles[variant]}>
                    <Warning size={24} weight="duotone" />
                </div>
                <div className="flex-1 pt-1">
                    <h3 className="text-lg font-semibold text-foreground" data-testid="confirm-dialog-title">{title}</h3>
                    <div className="mt-2 text-sm text-muted-foreground" data-testid="confirm-dialog-message">{message}</div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    data-testid="confirm-dialog-close"
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
                    data-testid="confirm-dialog-cancel"
                >
                    {cancelLabel}
                </Button>
                <Button
                    ref={confirmButtonRef}
                    type="button"
                    variant={variant === 'danger' ? 'destructive' : variant === 'warning' ? 'warning' : 'default'}
                    size="md"
                    onClick={onConfirm}
                    loading={loading}
                    disabled={loading}
                    data-testid="confirm-dialog-confirm"
                >
                    {loading ? 'Processing...' : confirmLabel}
                </Button>
            </div>
            </div>
        </Modal>
    );
}

