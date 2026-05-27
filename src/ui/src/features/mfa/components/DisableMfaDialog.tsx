import { useState } from 'react';
import { toast } from 'sonner';

import { Modal } from '@/components/ui/modal';
import { friendlyErrorMessage } from '@/config';
import { mfaClient } from '@/features/mfa/api/mfaApi';

interface DisableMfaDialogProps {
    onClose: () => void;
    onDisabled: () => void;
}

/**
 * Confirm disabling two factor authentication. We require a current
 * authenticator code so a stolen session cannot turn off MFA. Server
 * also bumps token_version so other sessions get signed out.
 */
export function DisableMfaDialog({ onClose, onDisabled }: DisableMfaDialogProps) {
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await mfaClient.disableMfa({ code: code.trim() });
            toast.success('Two factor authentication disabled.');
            onDisabled();
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Failed to disable MFA';
            setError(friendlyErrorMessage(raw) || raw);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal onClose={onClose} closeDisabled={submitting}>
            <form onSubmit={submit} className="space-y-4 p-6">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">
                        Disable two factor authentication
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Anyone who gets your password will be able to sign in. Enter a current
                        authenticator code to confirm.
                    </p>
                </div>
                <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    spellCheck={false}
                    autoFocus
                    required
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-center font-mono text-2xl tracking-widest text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                {error && (
                    <div
                        role="alert"
                        className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
                    >
                        {error}
                    </div>
                )}
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-accent"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || !code.trim()}
                        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                        {submitting ? 'Disabling...' : 'Disable'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
