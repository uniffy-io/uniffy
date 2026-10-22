import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Buildings,
  CircleNotch,
  Envelope,
  IdentificationCard,
  LinkSimple,
  Lock,
} from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { AuthInput } from "@/features/auth/components/AuthInput";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { readSetupRequired, setUpDeployment } from "@/features/auth/store/setupThunks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { MIN_SLUG_LENGTH, toSlug, toSlugDraft } from "@/shared/utils/slug";
import { ONBOARDING_PATH } from "@/features/onboarding/hooks/useOnboardingRedirect";

const MIN_PASSWORD_LENGTH = 8;

export function SetupPage() {
  useDocumentTitle("Set up Uniffy");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readSetupRequired().then((required) => {
      if (cancelled) return;
      // A failed config call shows the form; the server refuses setup once it is done.
      if (required === false) {
        navigate("/auth", { replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const shownSlug = slugEdited ? slugDraft : toSlug(organizationName);
  const canSubmit =
    !submitting &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    organizationName.trim().length > 0 &&
    toSlug(shownSlug).length >= MIN_SLUG_LENGTH;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const outcome = await dispatch(
      setUpDeployment({
        fullName,
        email,
        password,
        organizationName,
        organizationSlug: shownSlug,
      }),
    );
    if (outcome.status === "signed-in") {
      navigate(ONBOARDING_PATH, { replace: true });
      return;
    }
    setSubmitting(false);
    if (outcome.status === "already-set-up") {
      toast.error(outcome.message);
      navigate("/auth", { replace: true });
      return;
    }
    setError(outcome.message);
  };

  if (checking) {
    return (
      <AuthShell>
        <div className="flex justify-center py-16" role="status" aria-label="Loading">
          <CircleNotch className="h-6 w-6 animate-spin text-muted-foreground" weight="bold" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div
        className="mb-6 opacity-0"
        style={{ animation: "auth-slide-up 0.5s ease-out 0.2s forwards" }}
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
          First run
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          Set up your deployment
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the operator account and the first organization. You can add more people once you
          are in.
        </p>
      </div>

      {error && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
          style={{ animation: "auth-fade-in 0.2s ease-out" }}
          data-testid="setup-error-banner"
          role="alert"
        >
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 opacity-0"
        style={{ animation: "auth-slide-up 0.5s ease-out 0.3s forwards" }}
        data-testid="setup-form"
      >
        <AuthInput
          id="setup-fullname"
          label="Full name (optional)"
          value={fullName}
          onChange={setFullName}
          icon={IdentificationCard}
          autoFocus
          disabled={submitting}
        />
        <AuthInput
          id="setup-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          required
          icon={Envelope}
          disabled={submitting}
        />
        <AuthInput
          id="setup-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          required
          minLength={MIN_PASSWORD_LENGTH}
          icon={Lock}
          disabled={submitting}
        />
        <AuthInput
          id="setup-organization-name"
          label="Organization name"
          value={organizationName}
          onChange={setOrganizationName}
          required
          icon={Buildings}
          disabled={submitting}
        />
        <AuthInput
          id="setup-organization-slug"
          label="Organization slug"
          value={shownSlug}
          onChange={(value) => {
            setSlugEdited(true);
            setSlugDraft(toSlugDraft(value));
          }}
          required
          icon={LinkSimple}
          disabled={submitting}
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
          data-testid="setup-submit"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
              Setting up...
            </span>
          ) : (
            "Create and sign in"
          )}
        </button>
      </form>
    </AuthShell>
  );
}
