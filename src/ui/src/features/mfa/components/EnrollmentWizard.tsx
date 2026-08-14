import { useEffect, useState } from "react";
import { toast } from "sonner";

import { friendlyErrorMessage } from "@/config";
import { mfaClient } from "@/features/mfa/api/mfaApi";
import { RecoveryCodesView } from "@/features/mfa/components/RecoveryCodesView";

type Step = "scan" | "verify" | "recovery";

interface EnrollmentMaterial {
  secretB32: string;
  provisioningUri: string;
  qrSvgBase64: string;
}

interface EnrollmentResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  recoveryCodes: string[];
  organizationId?: string;
  organizationSlug?: string;
  organizationRole?: string;
  domainAdminDomains?: number[];
}

interface EnrollmentWizardProps {
  onComplete: (result: EnrollmentResult) => void;
  /** Omitted on the enrollment-required shell so the user cannot escape the requirement. */
  onCancel?: () => void;
}

/** TOTP enrollment: scan -> verify -> save recovery codes. */
export function EnrollmentWizard({ onComplete, onCancel }: EnrollmentWizardProps) {
  const [step, setStep] = useState<Step>("scan");
  const [material, setMaterial] = useState<EnrollmentMaterial | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [issuedTokens, setIssuedTokens] = useState<{
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    organizationId?: string;
    organizationSlug?: string;
    organizationRole?: string;
    domainAdminDomains?: number[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react/react-compiler -- minting the TOTP secret on mount; the wizard shows a spinner until the QR material arrives
    setLoading(true);
    mfaClient
      .beginEnrollment({})
      .then((response) => {
        if (cancelled) return;
        setMaterial({
          secretB32: response.secretB32,
          provisioningUri: response.provisioningUri,
          qrSvgBase64: response.qrSvgBase64,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : "Failed to start enrollment";
        setError(friendlyErrorMessage(raw) || raw);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await mfaClient.confirmEnrollment({ code: code.trim() });
      setRecoveryCodes(response.recoveryCodes);
      setIssuedTokens({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        sessionId: response.sessionId,
        organizationId: response.organizationId,
        organizationSlug: response.organizationSlug,
        organizationRole: response.organizationRole,
        domainAdminDomains: Array.from(response.domainAdminDomains),
      });
      setStep("recovery");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Verification failed";
      setError(friendlyErrorMessage(raw) || raw);
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    if (!material) return;
    await navigator.clipboard.writeText(material.secretB32);
    toast.success("Secret copied to clipboard.");
  };

  if (loading && !material) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Preparing your enrollment...
      </div>
    );
  }

  if (error && !material) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-50 p-6 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!material) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {step === "scan" && (
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Scan with your authenticator app
            </h3>
            <p className="text-sm text-muted-foreground">
              Use 1Password, Bitwarden, Aegis, Google Authenticator, or any RFC 6238 app. If your
              camera is unavailable, copy the secret below and paste it into your app instead.
            </p>
          </div>

          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="rounded-lg border border-border bg-white p-3">
              <img
                src={`data:image/svg+xml;base64,${material.qrSvgBase64}`}
                alt="TOTP enrollment QR code"
                className="h-44 w-44"
              />
            </div>

            <div className="flex-1 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Manual entry secret
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm tracking-widest">
                  {material.secretB32}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Not now
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setStep("verify")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === "verify" && (
        <form onSubmit={handleConfirm} className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Verify the connection</h3>
            <p className="text-sm text-muted-foreground">
              Enter the 6 digit code your authenticator is showing right now.
            </p>
          </div>

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
            data-testid="mfa-enroll-code"
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStep("scan");
                setCode("");
                setError(null);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify and enable"}
            </button>
          </div>
        </form>
      )}

      {step === "recovery" && issuedTokens && (
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Save your recovery codes</h3>
            <p className="text-sm text-muted-foreground">
              Each code works once and we only show them now. Save them somewhere only you can
              reach. If you lose your authenticator, one of these gets you back in.
            </p>
          </div>

          <RecoveryCodesView codes={recoveryCodes} />

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() =>
                onComplete({
                  accessToken: issuedTokens.accessToken,
                  refreshToken: issuedTokens.refreshToken,
                  sessionId: issuedTokens.sessionId,
                  recoveryCodes,
                  organizationId: issuedTokens.organizationId,
                  organizationSlug: issuedTokens.organizationSlug,
                  organizationRole: issuedTokens.organizationRole,
                  domainAdminDomains: issuedTokens.domainAdminDomains,
                })
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              I have saved my codes
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "scan", label: "Scan" },
    { key: "verify", label: "Verify" },
    { key: "recovery", label: "Recovery codes" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/30 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-muted-foreground/40">/</span>}
          </li>
        );
      })}
    </ol>
  );
}
