import { useEffect, useState } from 'react';
import { createClient } from '@connectrpc/connect';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Envelope,
    IdentificationCard,
    Lock,
    User,
    WarningCircle,
} from '@phosphor-icons/react';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import type { GetInvitationResponse } from '@uniffy/proto/auth/v1/auth_pb';
import { OrganizationRole } from '@uniffy/proto/common/v1/common_pb';
import {
    friendlyErrorMessage,
    initStorageEncryptionFromApi,
    setEnrollmentToken,
    setMemoryAccessToken,
    unaryTransport,
} from '@/config';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCredentials } from '@/features/auth/store/authSlice';
import { setAccentColor, setFontFamily } from '@/config/theme/themeSlice';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AuthInput } from '@/features/auth/components/AuthInput';
import { AuthShell } from '@/features/auth/components/AuthShell';

const authClient = createClient(AuthService, unaryTransport);

function roleLabel(role: OrganizationRole): string {
    switch (role) {
        case OrganizationRole.OWNER:
            return 'Owner';
        case OrganizationRole.ADMIN:
            return 'Admin';
        case OrganizationRole.MEMBER:
            return 'Member';
        default:
            return 'Member';
    }
}

export function AcceptInvitePage() {
    useDocumentTitle('Accept invitation');
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const navigate = useNavigate();
    const dispatch = useAppDispatch();
    const isAuthenticated = useAppSelector((s) => s.auth?.isAuthenticated ?? false);

    const [invitation, setInvitation] = useState<GetInvitationResponse | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(
        () => (token ? null : 'Missing invitation token.'),
    );
    const [previewLoading, setPreviewLoading] = useState<boolean>(() => !!token);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (isAuthenticated) navigate('/', { replace: true });
    }, [isAuthenticated, navigate]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        authClient
            .getInvitation({ token })
            .then((response) => {
                if (cancelled) return;
                setInvitation(response);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const raw = err instanceof Error ? err.message : 'Could not load invitation';
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
        !!invitation &&
        !submitting &&
        username.trim().length >= 3 &&
        password.length >= 8;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const response = await authClient.acceptInvitation({
                token,
                username: username.trim(),
                password,
                fullName: fullName.trim() || undefined,
            });
            const variant = response.result;
            if (variant.case === 'enrollmentRequired') {
                setEnrollmentToken(variant.value.enrollmentToken);
                navigate('/auth/enroll-mfa', { replace: true });
                return;
            }
            if (variant.case !== 'authResult') {
                setSubmitError('Unexpected invitation response. Please try again.');
                setSubmitting(false);
                return;
            }
            const r = variant.value;
            setMemoryAccessToken(r.accessToken);
            const authenticated = createClient(AuthService, unaryTransport);
            const profile = await authenticated.getCurrentUser(
                {},
                { headers: { Authorization: `Bearer ${r.accessToken}` } },
            );
            const plainUser = {
                id: profile.id,
                email: profile.email,
                username: profile.username,
                fullName: profile.fullName,
                isActive: profile.isActive,
                isSystemAdmin: profile.isSystemAdmin,
                emailVerified: profile.emailVerified,
                accentColor: profile.accentColor,
                fontFamily: profile.fontFamily,
                avatarUrl: profile.avatarUrl,
                hasAvatar: profile.hasAvatar,
            };
            if (profile.accentColor) dispatch(setAccentColor(profile.accentColor));
            if (profile.fontFamily) dispatch(setFontFamily(profile.fontFamily));
            dispatch(
                setCredentials({
                    user: plainUser,
                    accessToken: r.accessToken,
                    refreshToken: r.refreshToken,
                    organizationId: r.organizationId,
                    organizationSlug: r.organizationSlug,
                    organizationRole: r.organizationRole,
                    sessionId: r.sessionId,
                    domainAdminDomains: Array.from(r.domainAdminDomains),
                }),
            );
            initStorageEncryptionFromApi(plainUser.id).catch(() => undefined);
            navigate('/', { replace: true });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Could not accept invitation';
            setSubmitError(friendlyErrorMessage(raw) ?? raw);
            setSubmitting(false);
        }
    };

    if (isAuthenticated) return null;

    return (
        <AuthShell>
            <div
                className="mb-6 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.2s forwards' }}
            >
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                    Accept invitation
                </p>
                {!previewLoading && invitation && (
                    <>
                        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                            Join {invitation.organizationName}
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {invitation.inviterDisplayName
                                ? `${invitation.inviterDisplayName} invited you`
                                : 'You were invited'}
                            {' '}as <span className="font-medium text-foreground">{roleLabel(invitation.role)}</span>.
                        </p>
                    </>
                )}
                {previewLoading && (
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                        Loading invitation…
                    </h1>
                )}
            </div>

            {previewError && (
                <div
                    className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
                    style={{ animation: 'auth-fade-in 0.2s ease-out' }}
                >
                    <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-semibold">This invitation cannot be used</p>
                        <p className="text-xs opacity-90 mt-0.5">{previewError}</p>
                    </div>
                </div>
            )}

            {invitation && !previewError && (
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
                            id="invite-email"
                            label="Email"
                            type="email"
                            value={invitation.email}
                            onChange={() => undefined}
                            icon={Envelope}
                            readOnly
                        />
                        <AuthInput
                            id="invite-username"
                            label="Username"
                            type="text"
                            value={username}
                            onChange={setUsername}
                            required
                            minLength={3}
                            icon={User}
                            autoFocus
                            disabled={submitting}
                        />
                        <AuthInput
                            id="invite-password"
                            label="Password"
                            type="password"
                            value={password}
                            onChange={setPassword}
                            required
                            minLength={8}
                            icon={Lock}
                            disabled={submitting}
                        />
                        <AuthInput
                            id="invite-fullname"
                            label="Full name (optional)"
                            type="text"
                            value={fullName}
                            onChange={setFullName}
                            icon={IdentificationCard}
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
                                    Creating account…
                                </span>
                            ) : 'Accept invitation'}
                        </button>
                    </form>
                </div>
            )}

            <p
                className="mt-8 text-center text-xs text-muted-foreground/60 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.5s forwards' }}
            >
                Already have an account?{' '}
                <button
                    type="button"
                    onClick={() => navigate('/auth')}
                    className="underline hover:text-foreground"
                >
                    Sign in
                </button>
            </p>
        </AuthShell>
    );
}
