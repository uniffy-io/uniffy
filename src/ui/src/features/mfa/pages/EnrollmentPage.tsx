import { useNavigate } from "react-router-dom";

import { useAppDispatch } from "@/app/hooks";
import { Card } from "@/components/ui/card";
import { clearEnrollmentToken } from "@/config/api";
import { completeSignIn } from "@/features/auth/store/signInThunks";
import { EnrollmentWizard } from "@/features/mfa/components/EnrollmentWizard";

import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

/** Enrollment-required shell: the wizard exchanges the enrollment-only token for a real session. No "Not now". */
export function EnrollmentPage() {
  useDocumentTitle("Two factor enrollment");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const completeAndSignIn = async (result: {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    organizationId?: string;
    organizationSlug?: string;
    organizationRole?: string;
    domainAdminDomains?: number[];
  }) => {
    clearEnrollmentToken();
    try {
      await dispatch(
        completeSignIn({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          sessionId: result.sessionId,
          organizationId: result.organizationId,
          organizationSlug: result.organizationSlug,
          organizationRole: result.organizationRole,
          domainAdminDomains: result.domainAdminDomains,
        }),
      ).unwrap();
    } catch {
      // The rejected sign-in already reached the error toast.
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Set up two factor authentication</h1>
        <p className="mt-2 text-sm font-medium text-muted-foreground">
          This account requires two factor authentication. Finish enrolling and we will sign you in.
        </p>
      </div>

      <Card tone="surface" className="p-6">
        <EnrollmentWizard onComplete={completeAndSignIn} />
      </Card>
    </div>
  );
}
