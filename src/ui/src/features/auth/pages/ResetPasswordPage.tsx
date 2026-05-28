import { useEffect, useState } from 'react';
import { createClient } from '@connectrpc/connect';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { friendlyErrorMessage, unaryTransport } from '@/config';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AuthInput } from '@/features/auth/components/AuthInput';
import { AuthShell } from '@/features/auth/components/AuthShell';

const authClient = createClient(AuthService, unaryTransport);

export function ResetPasswordPage() {
    useDocumentTitle('Reset password');
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const navigate = useNavigate();

    // The reset URL carries the raw token in the query string. Without a
    // referrer policy, any third-party link the user clicks from this page
    // would leak the token to that origin via the Referer header. The token
    // is single-use and short-lived, but suppressing the referrer entirely
    // is cheap insurance and consistent with the privacy posture we promise
    // on the rest of the auth surface.
    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'referrer';
        meta.content = 'no-referrer';
        document.head.appendChild(meta);
        return () => {
            document.head.removeChild(meta);
        };
    }, []);

    const [bindingEmail, setBindingEmail] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(
        () => (token ? null : 'Missing reset token.'),
    );
    const [previewLoading, setPreviewLoading] = useState<boolean>(() => !!token);

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        authClient
            .verifyPasswordResetToken({ token })
            .then((response) => {
                if (cancelled) return;
                setBindingEmail(response.email);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const raw = err instanceof Error ? err.message : 'Reset link is invalid';
                setPreviewError(friendlyErrorMessage(raw) ?? raw);
            })
            .finally(() => {
                if (!cancelled) setPreviewLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const canSubmit =
        !!bindingEmail &&
        !submitting &&
        password.length >= 8 &&
        password === confirm;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await authClient.resetPassword({ token, newPassword: password });
            setDone(true);
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Could not reset password';
            setSubmitError(friendlyErrorMessage(raw) ?? raw);
            setSubmitting(false);
        }
    };

    return (
        <AuthShell>
            <div
                className="mb-6 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.2s forwards' }}
            >
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                    Reset password
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                    {done ? 'Password updated' : 'Pick a new password'}
                </h1>
                {!done && !previewLoading && bindingEmail && (
                    <p className="mt-1 text-sm text-muted-foreground">
                        For <span className="font-medium text-foreground">{bindingEmail}</span>.
                        All existing sessions will be signed out.
                    </p>
                )}
                {done && (
                    <p className="mt-1 text-sm text-muted-foreground">
                        Sign in with your new password.
                    </p>
                )}
            </div>

            {previewError && (
                <div
                    className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
                    style={{ animation: 'auth-fade-in 0.2s ease-out' }}
                >
                    <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-semibold">This reset link cannot be used</p>
                        <p className="text-xs opacity-90 mt-0.5">{previewError}</p>
                    </div>
                </div>
            )}

            {bindingEmail && !previewError && !done && (
                <div
                    className="opacity-0"
                    style={{ animation: 'auth-slide-up 0.5s ease-out 0.3s forwards' }}
                >
                    {submitError && (
                        <div
                            className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
                            style={{ animation: 'auth-fade-in 0.2s ease-out' }}
                        >
                            <svg className="h-4 w-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z" />
                            </svg>
                            <span>{submitError}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <AuthInput
                            id="reset-password"
                            label="New password"
                            type="password"
                            value={password}
                            onChange={setPassword}
                            required
                            minLength={8}
                            icon={Lock}
                            autoFocus
                            disabled={submitting}
                        />
                        <AuthInput
                            id="reset-confirm"
                            label="Confirm password"
                            type="password"
                            value={confirm}
                            onChange={setConfirm}
                            required
                            minLength={8}
                            icon={ShieldCheck}
                            disabled={submitting}
                        />

                        {confirm.length > 0 && confirm !== password && (
                            <p className="text-xs text-destructive">Passwords do not match.</p>
                        )}

                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                        >
                            {submitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="h-4 w-4" style={{ animation: 'auth-spinner 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" opacity="0.3" />
                                        <path d="M12 2v4" strokeLinecap="round" />
                                    </svg>
                                    Updating…
                                </span>
                            ) : 'Set new password'}
                        </button>
                    </form>
                </div>
            )}

            {done && (
                <button
                    type="button"
                    onClick={() => navigate('/auth')}
                    className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                >
                    Sign in
                </button>
            )}
        </AuthShell>
    );
}
