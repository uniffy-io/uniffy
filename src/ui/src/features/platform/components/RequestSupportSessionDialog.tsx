import { useState } from 'react';
import { toast } from 'sonner';
import { Lifebuoy, X } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/config';
import { supportSessionsApi } from '@/features/platform/api/supportSessionsApi';
import { SupportSessionScope } from '@uniffy/proto/support/v1/support_consent_pb';

interface Props {
    organizationId: string;
    organizationName: string;
    onClose: () => void;
    onCreated: () => void;
}

const MIN_DURATION = 5;
const MAX_DURATION = 120;
const DEFAULT_DURATION = 30;

export function RequestSupportSessionDialog({
    organizationId,
    organizationName,
    onClose,
    onCreated,
}: Props) {
    const [reason, setReason] = useState('');
    const [duration, setDuration] = useState(DEFAULT_DURATION);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        const trimmed = reason.trim();
        if (!trimmed) {
            toast.error('Reason is required');
            return;
        }
        setSubmitting(true);
        try {
            await supportSessionsApi.request({
                organizationId,
                reason: trimmed,
                scope: SupportSessionScope.READ_ONLY,
                durationMinutes: duration,
            });
            toast.success(
                'Request sent. The org owner must approve before access begins.',
            );
            onCreated();
            onClose();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
            <div className="flex items-start gap-3 p-4 border-b border-border">
                <div className="p-2 rounded-lg bg-amber-500/15 shrink-0">
                    <Lifebuoy
                        size={20}
                        weight="duotone"
                        className="text-amber-700 dark:text-amber-300"
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-foreground">
                        Request support session
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        Read-only access to {organizationName}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close"
                >
                    <X size={16} weight="bold" />
                </button>
            </div>

            <div className="p-4 space-y-4">
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
                    The org owner will receive an in-app notification and email.
                    Access begins only after they approve. Every action you take
                    while the session is active is recorded in their audit log.
                </div>

                <div>
                    <label
                        htmlFor="support-reason"
                        className="text-xs font-medium text-muted-foreground block mb-1"
                    >
                        Reason
                    </label>
                    <textarea
                        id="support-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={4}
                        maxLength={2000}
                        placeholder="e.g. Ticket #1234 - help debugging notes that won't open"
                        className="w-full bg-input border border-border rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        disabled={submitting}
                    />
                    <div className="text-[10px] text-muted-foreground text-right mt-0.5">
                        {reason.length} / 2000
                    </div>
                </div>

                <div>
                    <label
                        htmlFor="support-duration"
                        className="text-xs font-medium text-muted-foreground block mb-1"
                    >
                        Duration: {duration} minutes
                    </label>
                    <input
                        id="support-duration"
                        type="range"
                        min={MIN_DURATION}
                        max={MAX_DURATION}
                        step={5}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        disabled={submitting}
                        className="w-full accent-amber-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>{MIN_DURATION}m</span>
                        <span>{MAX_DURATION}m max</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                        Scope
                    </label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                        Read-only
                        <span className="text-xs text-muted-foreground">
                            (read-write not supported in v1)
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                <Button
                    variant="ghost"
                    size="md"
                    onClick={onClose}
                    disabled={submitting}
                >
                    Cancel
                </Button>
                <Button
                    variant="default"
                    size="md"
                    onClick={handleSubmit}
                    disabled={submitting || reason.trim().length === 0}
                >
                    <Lifebuoy size={14} weight="duotone" />
                    Request access
                </Button>
            </div>
        </Modal>
    );
}
