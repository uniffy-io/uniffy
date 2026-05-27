import { useState } from 'react';
import { createClient } from '@connectrpc/connect';
import { useNavigate } from 'react-router-dom';
import { Envelope, ArrowLeft } from '@phosphor-icons/react';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { unaryTransport } from '@/config/api';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AuthInput } from '@/features/auth/components/AuthInput';
import { AuthShell } from '@/features/auth/components/AuthShell';

const authClient = createClient(AuthService, unaryTransport);

export function ForgotPasswordPage() {
    useDocumentTitle('Forgot password');
    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const trimmed = email.trim();
    const canSubmit = !submitting && trimmed.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            await authClient.sendPasswordReset({ email: trimmed });
        } catch {
            // Always show the success state so we never leak whether the email exists.
        }
        setSubmitting(false);
        setSubmitted(true);
    };

    return (
        <AuthShell>
            <div
                className="mb-6 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.2s forwards' }}
            >
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                    Forgot password
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                    Reset your password
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {submitted
                        ? 'Check your inbox for a reset link.'
                        : 'Enter your email and we will send you a single-use reset link.'}
                </p>
            </div>

            {!submitted && (
                <div
                    className="opacity-0"
                    style={{ animation: 'auth-slide-up 0.5s ease-out 0.3s forwards' }}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <AuthInput
                            id="forgot-email"
                            label="Email"
                            type="email"
                            value={email}
                            onChange={setEmail}
                            required
                            icon={Envelope}
                            autoFocus
                            disabled={submitting}
                        />

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
                                    Sending…
                                </span>
                            ) : 'Send reset link'}
                        </button>
                    </form>
                </div>
            )}

            {submitted && (
                <div
                    className="rounded-lg border border-border bg-card p-4 text-sm text-foreground opacity-0"
                    style={{ animation: 'auth-fade-in 0.4s ease-out 0.1s forwards' }}
                >
                    <p>If an account exists for <span className="font-medium">{trimmed}</span>, a reset link is on its way.</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                        The link expires in 30 minutes and can only be used once.
                    </p>
                </div>
            )}

            <p
                className="mt-8 text-center text-xs text-muted-foreground/70 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.5s forwards' }}
            >
                <button
                    type="button"
                    onClick={() => navigate('/auth')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                >
                    <ArrowLeft size={12} /> Back to sign in
                </button>
            </p>
        </AuthShell>
    );
}
