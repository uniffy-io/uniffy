import { createClient } from '@connectrpc/connect';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import {
    clearEnrollmentToken,
    setMemoryAccessToken,
    unaryTransport,
} from '@/config/api';
import { setCredentials } from '@/features/auth/store/authSlice';
import { EnrollmentWizard } from '@/features/mfa/components/EnrollmentWizard';

import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';

import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

/** Enrollment-required shell: the wizard exchanges the enrollment-only token for a real session. No "Not now". */
export function EnrollmentPage() {
    useDocumentTitle('Two factor enrollment');
    const dispatch = useAppDispatch();
    const navigate = useNavigate();

    const completeAndSignIn = async (accessToken: string, refreshToken: string, sessionId: string) => {
        // ConfirmEnrollment minted a real session; the enrollment-only
        // token is now spent and any leftover slot value would just be
        // dead state - clear it before swapping in the real access token.
        clearEnrollmentToken();
        setMemoryAccessToken(accessToken);
        const client = createClient(AuthService, unaryTransport);
        const me = await client.getCurrentUser(
            {},
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const plainUser = {
            id: me.id,
            email: me.email,
            username: me.username,
            fullName: me.fullName,
            isActive: me.isActive,
            isSystemAdmin: me.isSystemAdmin,
            emailVerified: me.emailVerified,
            accentColor: me.accentColor,
            fontFamily: me.fontFamily,
            avatarUrl: me.avatarUrl,
            hasAvatar: me.hasAvatar,
        };
        dispatch(
            setCredentials({
                user: plainUser,
                accessToken,
                refreshToken,
                sessionId,
            }),
        );
        navigate('/', { replace: true });
    };

    return (
        <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-12">
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold text-foreground">
                    Set up two factor authentication
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    This account requires two factor authentication. Finish enrolling and we will
                    sign you in.
                </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-6">
                <EnrollmentWizard
                    onComplete={(result) =>
                        completeAndSignIn(
                            result.accessToken,
                            result.refreshToken,
                            result.sessionId,
                        )
                    }
                />
            </div>
        </div>
    );
}
