import { useState } from 'react';

import { Modal } from '@/components/ui/modal';
import { friendlyErrorMessage } from '@/config';
import { mfaClient } from '@/features/mfa/api/mfaApi';
import { RecoveryCodesView } from '@/features/mfa/components/RecoveryCodesView';

interface RegenerateCodesDialogProps {
    onClose: () => void;
    onRegenerated: () => void;
}

/** Old codes are invalidated server-side; the new batch is shown once. */
export function RegenerateCodesDialog({ onClose, onRegenerated }: RegenerateCodesDialogProps) {
    const [code, setCode] = useState('');
    const [codes, setCodes] = useState<string[] | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await mfaClient.regenerateRecoveryCodes({ code: code.trim() });
            setCodes(response.recoveryCodes);
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Failed to regenerate codes';
            setError(friendlyErrorMessage(raw) || raw);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDone = () => {
        onRegenerated();
        onClose();
    };

    return (
        <Modal onClose={onClose} closeDisabled={submitting}>
            <div className="space-y-4 p-6">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Regenerate recovery codes</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Your old recovery codes will stop working. Confirm with a current
                        authenticator code and save the new ones somewhere only you can reach.
                    </p>
                </div>

                {codes ? (
                    <>
                        <RecoveryCodesView codes={codes} />
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={handleDone}
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                            >
                                I have saved my codes
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={submit} className="space-y-4">
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
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                            >
                                {submitting ? 'Generating...' : 'Generate'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </Modal>
    );
}
