import { Modal } from '@/components/ui/modal';
import { Lock, ShieldCheck, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { friendlyErrorMessage } from '@/config';
import { mfaClient } from '@/features/mfa/api/mfaApi';
import { DisableMfaDialog } from '@/features/mfa/components/DisableMfaDialog';
import { EnrollmentWizard } from '@/features/mfa/components/EnrollmentWizard';
import { RegenerateCodesDialog } from '@/features/mfa/components/RegenerateCodesDialog';

import type { GetMfaStatusResponse } from '@uniffy/proto/auth/v1/mfa_pb';

type StatusSnapshot = {
    enabled: boolean;
    enrolledAt: Date | null;
    lastUsedAt: Date | null;
    remainingRecoveryCodes: number;
};

function toSnapshot(s: GetMfaStatusResponse): StatusSnapshot {
    const toDate = (t?: { seconds: bigint; nanos: number }) =>
        t ? new Date(Number(t.seconds) * 1000 + Math.floor(t.nanos / 1_000_000)) : null;
    return {
        enabled: s.enabled,
        enrolledAt: toDate(s.enrolledAt),
        lastUsedAt: toDate(s.lastUsedAt),
        remainingRecoveryCodes: s.remainingRecoveryCodes,
    };
}

const LOW_RECOVERY_THRESHOLD = 3;

export function MfaSettingsCard() {
    const [status, setStatus] = useState<StatusSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [showDisable, setShowDisable] = useState(false);
    const [showRegenerate, setShowRegenerate] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const response = await mfaClient.getMfaStatus({});
            setStatus(toSnapshot(response));
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Failed to load MFA status';
            setError(friendlyErrorMessage(raw) || raw);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch syncs with backend
        refresh();
    }, [refresh]);

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Two factor authentication</h2>
                {status?.enabled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <ShieldCheck size={14} weight="fill" /> Enabled
                    </span>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 md:p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <Lock size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="space-y-1">
                        <p className="text-sm text-foreground">
                            Protect your account with an authenticator app. We ask for a 6 digit
                            code on every sign in once enrollment is complete.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Works with 1Password, Bitwarden, Aegis, Google Authenticator, and any
                            RFC 6238 app.
                        </p>
                    </div>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
                    >
                        {error}
                    </div>
                )}

                {status && !status.enabled && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium text-foreground">Not yet enrolled</p>
                            <p className="text-xs text-muted-foreground">
                                Strongly recommended for any account that holds production data.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowWizard(true)}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                        >
                            Enable
                        </button>
                    </div>
                )}

                {status?.enabled && (
                    <div className="space-y-3 border-t border-border pt-4">
                        <DetailRow
                            label="Enrolled"
                            value={status.enrolledAt ? status.enrolledAt.toLocaleDateString() : '-'}
                        />
                        <DetailRow
                            label="Last used"
                            value={
                                status.lastUsedAt
                                    ? `${status.lastUsedAt.toLocaleDateString()} ${status.lastUsedAt.toLocaleTimeString()}`
                                    : 'Never'
                            }
                        />
                        <DetailRow
                            label="Recovery codes remaining"
                            value={`${status.remainingRecoveryCodes} of 10`}
                            warning={status.remainingRecoveryCodes <= LOW_RECOVERY_THRESHOLD}
                        />

                        {status.remainingRecoveryCodes <= LOW_RECOVERY_THRESHOLD && (
                            <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                                <Warning size={14} className="mt-0.5 shrink-0" />
                                You are running low on recovery codes. Regenerate before you lose
                                your authenticator.
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowRegenerate(true)}
                                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent"
                            >
                                Regenerate recovery codes
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowDisable(true)}
                                className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                            >
                                Disable
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {showWizard && (
                <Modal onClose={() => setShowWizard(false)} maxWidth="max-w-2xl">
                    <div className="p-6">
                        <EnrollmentWizard
                            onCancel={() => setShowWizard(false)}
                            onComplete={async () => {
                                setShowWizard(false);
                                await refresh();
                            }}
                        />
                    </div>
                </Modal>
            )}

            {showDisable && (
                <DisableMfaDialog
                    onClose={() => setShowDisable(false)}
                    onDisabled={async () => {
                        setShowDisable(false);
                        await refresh();
                    }}
                />
            )}

            {showRegenerate && (
                <RegenerateCodesDialog
                    onClose={() => setShowRegenerate(false)}
                    onRegenerated={refresh}
                />
            )}
        </section>
    );
}

function DetailRow({
    label,
    value,
    warning,
}: {
    label: string;
    value: string;
    warning?: boolean;
}) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className={warning ? 'font-medium text-yellow-700 dark:text-yellow-300' : 'text-foreground'}>
                {value}
            </span>
        </div>
    );
}
