import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ConnectError, createClient } from "@connectrpc/connect";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Envelope, IdentificationCard, Lock, User, WarningCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { AuthService } from "@uniffy/proto/auth/v1/auth_pb";
import type { GetInvitationResponse } from "@uniffy/proto/auth/v1/auth_pb";
import { setEnrollmentToken, unaryTransport } from "@/config";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AuthInput } from "@/features/auth/components/AuthInput";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import { useSignOut } from "@/features/auth/hooks/useSignOut";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import { acceptInvitation } from "@/features/auth/store/invitationsThunks";
import { completeSignIn } from "@/features/auth/store/signInThunks";
import {
  invitationErrorMessage,
  invitationHeading,
  isSessionPending,
  isSignInRequired,
  resolveAcceptState,
  type SignInInvitation,
} from "@/features/auth/utils/acceptInviteState";
import { getRoleLabel } from "@/features/auth/utils/organizationRoles";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";

const authClient = createClient(AuthService, unaryTransport);

const ACCEPT_FAILED_MESSAGE = "Could not accept the invitation. Try again.";

interface AuthActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

function AuthAction({ busy = false, busyLabel, children, className, ...props }: AuthActionProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "auth-btn w-full h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200",
        className,
      )}
    >
      {busy ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="h-4 w-4"
            style={{ animation: "auth-spinner 0.8s linear infinite" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path
              d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
              strokeLinecap="round"
              opacity="0.3"
            />
            <path d="M12 2v4" strokeLinecap="round" />
          </svg>
          {busyLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
      style={{ animation: "auth-fade-in 0.2s ease-out" }}
    >
      <WarningCircle size={16} weight="fill" className="mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function AcceptInvitePage() {
  useDocumentTitle("Accept invitation");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.auth?.isAuthenticated ?? false);
  const isRehydrating = useAppSelector((s) => s.auth?.isRehydrating ?? false);
  const refreshToken = useAppSelector((s) => s.auth?.refreshToken ?? null);
  const userEmail = useAppSelector((s) => s.auth?.user?.email ?? null);
  const signOut = useSignOut();
  const { guardSwitch, confirmDialog } = useSwitchOrganization();

  const [invitation, setInvitation] = useState<GetInvitationResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(() =>
    token ? null : "Missing invitation token.",
  );
  const [previewLoading, setPreviewLoading] = useState<boolean>(() => !!token);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [joining, setJoining] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingUnsynced, setConfirmingUnsynced] = useState(false);

  // Signing in returns here with the token, so the invitation is accepted signed in.
  const returnTo = { pathname: location.pathname, search: location.search };

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
        setPreviewError(invitationErrorMessage(err) ?? "Could not load the invitation.");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // A stored session that is still rehydrating reads as signed out, so no view resolves before it.
  const sessionPending = isSessionPending({ isAuthenticated, isRehydrating, refreshToken });
  const loading = previewLoading || sessionPending;
  // The form stays up while its own sign-in lands, so the signed-in states do not flash past.
  const view =
    invitation && !previewError && !sessionPending
      ? submitting
        ? "form"
        : resolveAcceptState({ isAuthenticated, userEmail, invitation, signInRequired })
      : null;

  const canSubmit =
    !!invitation && !submitting && username.trim().length >= 3 && password.length >= 8;

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
      if (variant.case === "enrollmentRequired") {
        setEnrollmentToken(variant.value.enrollmentToken);
        navigate("/auth/enroll-mfa", { replace: true });
        return;
      }
      if (variant.case !== "authResult") {
        setSubmitError("Unexpected invitation response. Please try again.");
        setSubmitting(false);
        return;
      }
      const r = variant.value;
      await dispatch(
        completeSignIn({
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          organizationId: r.organizationId,
          organizationSlug: r.organizationSlug,
          organizationRole: r.organizationRole,
          sessionId: r.sessionId,
          domainAdminDomains: Array.from(r.domainAdminDomains),
        }),
      ).unwrap();
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setSubmitting(false);
      if (isSignInRequired(err)) {
        setSignInRequired(true);
        return;
      }
      setSubmitError(invitationErrorMessage(err) ?? ACCEPT_FAILED_MESSAGE);
    }
  };

  const signInToAccept = () =>
    navigate("/auth", {
      state: {
        from: returnTo,
        invitation: invitation
          ? ({
              email: invitation.email,
              organizationName: invitation.organizationName,
            } satisfies SignInInvitation)
          : undefined,
      },
    });

  // Joining moves this tab into the organization, so the switch confirmation runs first.
  const handleJoin = () =>
    guardSwitch(async () => {
      setJoining(true);
      setSubmitError(null);
      try {
        const accepted = await dispatch(acceptInvitation({ token }));
        toast.success(`Welcome to ${accepted.organizationName}`);
        navigate("/", { replace: true });
      } catch (err) {
        setJoining(false);
        if (err instanceof ConnectError) {
          setSubmitError(invitationErrorMessage(err) ?? ACCEPT_FAILED_MESSAGE);
          return;
        }
        // The membership landed and only the switch failed, which toasted already.
        navigate("/welcome", { replace: true });
      }
    });

  const handleSignOut = async (discardUnsynced = false) => {
    setSigningOut(true);
    const signedOut = await signOut({
      discardUnsynced,
      returnTo: location.pathname + location.search,
    });
    setSigningOut(false);
    if (!signedOut) setConfirmingUnsynced(true);
  };

  const organizationName = invitation?.organizationName ?? "";
  const roleLabel = invitation ? getRoleLabel(invitation.role) : "";
  const heading = invitation && view ? invitationHeading(invitation, view) : null;

  return (
    <AuthShell>
      {confirmDialog}
      <ConfirmDialog
        isOpen={confirmingUnsynced}
        onClose={() => setConfirmingUnsynced(false)}
        onConfirm={() => {
          setConfirmingUnsynced(false);
          void handleSignOut(true);
        }}
        title="Discard unsynced edits?"
        message="Some edits have not reached the server yet. Signing out now discards them."
        confirmLabel="Discard and sign out"
        cancelLabel="Stay"
        variant="warning"
      />

      <div
        className="mb-6 opacity-0"
        style={{ animation: "auth-slide-up 0.5s ease-out 0.2s forwards" }}
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
          Accept invitation
        </p>
        {!loading && heading && (
          <>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {heading.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {heading.invited} as <span className="font-medium text-foreground">{roleLabel}</span>.
            </p>
          </>
        )}
        {loading && (
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            Loading invitation…
          </h1>
        )}
      </div>

      {previewError && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
          style={{ animation: "auth-fade-in 0.2s ease-out" }}
        >
          <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">This invitation cannot be used</p>
            <p className="text-xs opacity-90 mt-0.5">{previewError}</p>
          </div>
        </div>
      )}

      {invitation && view && (
        <div
          className="opacity-0"
          style={{ animation: "auth-slide-up 0.5s ease-out 0.3s forwards" }}
        >
          {submitError && <InlineError message={submitError} />}

          {view === "form" && (
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

              <AuthAction
                type="submit"
                disabled={!canSubmit}
                busy={submitting}
                busyLabel="Creating account…"
                className="mt-2"
              >
                Accept invitation
              </AuthAction>
            </form>
          )}

          {view === "sign-in" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                You already have an account for{" "}
                <span className="font-medium text-foreground">{invitation.email}</span>.
              </p>
              <AuthAction onClick={signInToAccept}>Sign in to accept</AuthAction>
            </div>
          )}

          {view === "join" && (
            <div className="space-y-5">
              <Card tone="surface" className="flex items-center gap-3 p-4">
                <OrganizationAvatar
                  name={organizationName}
                  className="h-10 w-10 rounded-lg text-sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {organizationName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    Joining as {roleLabel} with {invitation.email}
                  </p>
                </div>
              </Card>
              <AuthAction
                disabled={joining}
                busy={joining}
                busyLabel="Joining…"
                onClick={() => void handleJoin()}
              >
                Join {organizationName}
              </AuthAction>
            </div>
          )}

          {view === "mismatch" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                You are signed in as{" "}
                <span className="font-medium text-foreground">{userEmail}</span>. This invitation is
                for <span className="font-medium text-foreground">{invitation.email}</span>.
              </p>
              <div className="space-y-3">
                <AuthAction
                  disabled={signingOut}
                  busy={signingOut}
                  busyLabel="Signing out…"
                  onClick={() => void handleSignOut()}
                >
                  Sign out and continue
                </AuthAction>
                <Link
                  to="/"
                  className="flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-semibold text-foreground transition-colors duration-200 hover:border-border-strong hover:bg-muted/40 focus-ring"
                >
                  Go to Uniffy
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {!isAuthenticated && !sessionPending && (view === "form" || previewError) && (
        <p
          className="mt-8 text-center text-xs text-subtle-foreground opacity-0"
          style={{ animation: "auth-slide-up 0.5s ease-out 0.5s forwards" }}
        >
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => (view === "form" ? signInToAccept() : navigate("/auth"))}
            className="underline hover:text-foreground"
          >
            Sign in
          </button>
        </p>
      )}

      {isAuthenticated && previewError && (
        <p className="mt-8 text-center text-xs text-subtle-foreground">
          <Link to="/" className="underline hover:text-foreground">
            Go to Uniffy
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
