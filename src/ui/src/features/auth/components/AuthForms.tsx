import { useState, useEffect } from 'react';
import { createClient } from '@connectrpc/connect';
import { Link, useNavigate } from 'react-router-dom';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCredentials } from '@/features/auth/store/authSlice';
import { setAccentColor, setFontFamily } from '@/config/theme/themeSlice';
import {
    friendlyErrorMessage,
    initStorageEncryptionFromApi,
    setEnrollmentToken,
    setMemoryAccessToken,
    unaryTransport,
} from '@/config';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { Envelope, IdentificationCard, Lock, User } from '@phosphor-icons/react';
import { AuthInput } from '@/features/auth/components/AuthInput';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { LoginMfaStep } from '@/features/mfa';

const authClient = createClient(AuthService, unaryTransport);

export function AuthForms() {
    useDocumentTitle('Login');

    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [publicRegistrationEnabled, setPublicRegistrationEnabled] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        authClient
            .getAuthConfig({})
            .then((response) => {
                if (cancelled) return;
                setPublicRegistrationEnabled(response.publicRegistrationEnabled);
                if (!response.publicRegistrationEnabled) setMode('login');
            })
            .catch(() => {
                if (!cancelled) setPublicRegistrationEnabled(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const navigate = useNavigate();
    const dispatch = useAppDispatch();
    const isAuthenticated = useAppSelector((state) => state.auth?.isAuthenticated ?? false);
    const currentOrganizationId = useAppSelector((state) => state.auth?.currentOrganizationId);

    useEffect(() => {
        if (isAuthenticated) {
            if (currentOrganizationId) {
                navigate('/', { replace: true });
            } else {
                navigate('/select-org', { replace: true });
            }
        }
    }, [isAuthenticated, currentOrganizationId, navigate]);

    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);

    const fetchUserAndDispatch = async (
        accessToken: string,
        refreshToken: string,
        organizationId?: string,
        organizationRole?: string,
        sessionId?: string,
        domainAdminDomains?: number[],
    ) => {
        try {
            setMemoryAccessToken(accessToken);
            const authenticatedClient = createClient(AuthService, unaryTransport);
            const userResponse = await authenticatedClient.getCurrentUser(
                {},
                { headers: { Authorization: `Bearer ${accessToken}` } },
            );

            const plainUser = {
                id: userResponse.id,
                email: userResponse.email,
                username: userResponse.username,
                fullName: userResponse.fullName,
                isActive: userResponse.isActive,
                isSystemAdmin: userResponse.isSystemAdmin,
                emailVerified: userResponse.emailVerified,
                accentColor: userResponse.accentColor,
                fontFamily: userResponse.fontFamily,
                avatarUrl: userResponse.avatarUrl,
                hasAvatar: userResponse.hasAvatar,
            };

            if (userResponse.accentColor) dispatch(setAccentColor(userResponse.accentColor));
            if (userResponse.fontFamily) dispatch(setFontFamily(userResponse.fontFamily));

            dispatch(
                setCredentials({
                    user: plainUser,
                    accessToken,
                    refreshToken,
                    organizationId,
                    organizationRole,
                    sessionId,
                    domainAdminDomains,
                }),
            );

            initStorageEncryptionFromApi(plainUser.id).catch((err) => {
                console.warn('Storage encryption init failed:', err);
            });
        } catch {
            throw new Error('Failed to fetch user details');
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const response = await authClient.register({
                email,
                username,
                password,
                fullName: fullName || undefined,
            });
            await fetchUserAndDispatch(
                response.accessToken,
                response.refreshToken,
                response.organizationId,
                response.organizationRole,
                response.sessionId,
                Array.from(response.domainAdminDomains),
            );
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Registration failed';
            setError(friendlyErrorMessage(raw) || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const response = await authClient.login({ email, password });
            const variant = response.result;
            if (variant.case === 'authResult') {
                const r = variant.value;
                await fetchUserAndDispatch(
                    r.accessToken,
                    r.refreshToken,
                    r.organizationId,
                    r.organizationRole,
                    r.sessionId,
                    Array.from(r.domainAdminDomains),
                );
            } else if (variant.case === 'mfaChallenge') {
                setMfaChallengeToken(variant.value.challengeToken);
            } else if (variant.case === 'enrollmentRequired') {
                setEnrollmentToken(variant.value.enrollmentToken);
                navigate('/auth/enroll-mfa', { replace: true });
            } else {
                setError('Unexpected login response. Please try again.');
            }
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : 'Login failed';
            setError(friendlyErrorMessage(raw) || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    const handleMfaVerified = async (params: {
        accessToken: string;
        refreshToken: string;
        organizationId?: string;
        organizationRole?: string;
        sessionId?: string;
    }) => {
        await fetchUserAndDispatch(
            params.accessToken,
            params.refreshToken,
            params.organizationId,
            params.organizationRole,
            params.sessionId,
            [],
        );
        setMfaChallengeToken(null);
    };

    if (isAuthenticated) return null;

    if (mfaChallengeToken) {
        return (
            <LoginMfaStep
                challengeToken={mfaChallengeToken}
                onVerified={handleMfaVerified}
                onCancel={() => {
                    setMfaChallengeToken(null);
                    setError(null);
                }}
            />
        );
    }

    return (
        <AuthShell>
            {publicRegistrationEnabled !== false && (
                <div
                    className="mb-6 opacity-0"
                    style={{ animation: 'auth-slide-up 0.5s ease-out 0.2s forwards' }}
                >
                    <div className="relative flex bg-muted rounded-lg p-1">
                        <div
                            className="absolute top-1 bottom-1 rounded-md bg-card shadow-sm border border-border transition-all duration-300 ease-out"
                            style={{
                                left: mode === 'login' ? '4px' : '50%',
                                width: 'calc(50% - 4px)',
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => { setMode('login'); setError(null); }}
                            className={`relative z-10 flex-1 py-2 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer ${mode === 'login' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            data-testid="auth-mode-login"
                            data-active={mode === 'login' ? 'true' : 'false'}
                        >
                            Sign in
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMode('register'); setError(null); }}
                            className={`relative z-10 flex-1 py-2 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer ${mode === 'register' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            data-testid="auth-mode-register"
                            data-active={mode === 'register' ? 'true' : 'false'}
                        >
                            Register
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div
                    className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
                    style={{ animation: 'auth-fade-in 0.2s ease-out' }}
                    data-testid="auth-error-banner"
                >
                    <svg className="h-4 w-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z" />
                    </svg>
                    <span>{error}</span>
                </div>
            )}

            <div
                className="opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.3s forwards' }}
            >
                {mode === 'register' ? (
                    <form onSubmit={handleRegister} className="space-y-4" data-testid="auth-form-register">
                        <AuthInput
                            id="reg-email"
                            label="Email"
                            type="email"
                            value={email}
                            onChange={setEmail}
                            required
                            icon={Envelope}
                            autoFocus
                        />
                        <AuthInput
                            id="reg-username"
                            label="Username"
                            type="text"
                            value={username}
                            onChange={setUsername}
                            required
                            minLength={3}
                            icon={User}
                        />
                        <AuthInput
                            id="reg-password"
                            label="Password"
                            type="password"
                            value={password}
                            onChange={setPassword}
                            required
                            minLength={8}
                            icon={Lock}
                        />
                        <AuthInput
                            id="reg-fullname"
                            label="Full name (optional)"
                            type="text"
                            value={fullName}
                            onChange={setFullName}
                            icon={IdentificationCard}
                        />

                        <button
                            type="submit"
                            disabled={loading}
                            className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                            data-testid="auth-submit-register"
                            data-loading={loading ? 'true' : 'false'}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="h-4 w-4" style={{ animation: 'auth-spinner 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" opacity="0.3" />
                                        <path d="M12 2v4" strokeLinecap="round" />
                                    </svg>
                                    Creating account...
                                </span>
                            ) : 'Create account'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleLogin} className="space-y-4" data-testid="auth-form-login">
                        <AuthInput
                            id="login-email"
                            label="Email"
                            type="email"
                            value={email}
                            onChange={setEmail}
                            required
                            icon={Envelope}
                            autoFocus
                        />
                        <AuthInput
                            id="login-password"
                            label="Password"
                            type="password"
                            value={password}
                            onChange={setPassword}
                            required
                            icon={Lock}
                        />

                        <button
                            type="submit"
                            disabled={loading}
                            className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
                            data-testid="auth-submit-login"
                            data-loading={loading ? 'true' : 'false'}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="h-4 w-4" style={{ animation: 'auth-spinner 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" opacity="0.3" />
                                        <path d="M12 2v4" strokeLinecap="round" />
                                    </svg>
                                    Signing in...
                                </span>
                            ) : 'Sign in'}
                        </button>
                    </form>
                )}
            </div>

            {mode === 'login' && (
                <p
                    className="mt-4 text-center text-xs text-muted-foreground/80 opacity-0"
                    style={{ animation: 'auth-slide-up 0.5s ease-out 0.4s forwards' }}
                >
                    <Link to="/auth/forgot-password" className="hover:text-foreground underline">
                        Forgot your password?
                    </Link>
                </p>
            )}

            <p
                className="mt-8 text-center text-xs text-muted-foreground/60 opacity-0"
                style={{ animation: 'auth-slide-up 0.5s ease-out 0.5s forwards' }}
            >
                By continuing, you agree to the uniffy terms of service.
            </p>
        </AuthShell>
    );
}
