import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/features/auth/components/AuthShell";
import { BRAND_ACCENT, BRAND_ACCENT_RING } from "@/features/auth/constants";
import { mfaUnaryClient } from "@/features/mfa/api/mfaApi";

/** Strips the `[status]` prefix so the inline banner shows the server text, not `friendlyErrorMessage`'s generic unauth copy. */
function verifyErrorMessage(raw: string): string {
  const match = raw.match(/^\[[a-z_]+\]\s*(.+)$/i);
  const body = (match ? match[1] : raw).trim();
  const lower = body.toLowerCase();
  if (lower.includes("challenge")) {
    return "Your sign in attempt expired. Go back and enter your password again.";
  }
  if (lower.includes("too many attempts")) {
    return "Too many attempts. Try again in 15 minutes.";
  }
  if (!body) {
    return "Verification failed";
  }
  return body;
}

interface LoginMfaStepProps {
  challengeToken: string;
  onVerified: (params: {
    accessToken: string;
    refreshToken: string;
    organizationId?: string;
    organizationSlug?: string;
    organizationRole?: string;
    sessionId?: string;
    usedRecoveryCode: boolean;
    remainingRecoveryCodes: number;
    domainAdminDomains?: number[];
  }) => Promise<void>;
  onCancel: () => void;
}

export function LoginMfaStep({ challengeToken, onVerified, onCancel }: LoginMfaStepProps) {
  const [method, setMethod] = useState<"totp" | "recovery_code">("totp");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [method]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await mfaUnaryClient.verifyMfa({
        challengeToken,
        code: code.trim(),
        method,
      });
      await onVerified({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        organizationId: response.organizationId,
        organizationSlug: response.organizationSlug,
        organizationRole: response.organizationRole,
        sessionId: response.sessionId,
        usedRecoveryCode: response.usedRecoveryCode,
        remainingRecoveryCodes: response.remainingRecoveryCodes,
        domainAdminDomains: Array.from(response.domainAdminDomains),
      });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Verification failed";
      setError(verifyErrorMessage(raw));
    } finally {
      setLoading(false);
    }
  };

  const placeholder = method === "totp" ? "123 456" : "xxxx-xxxx-xxxx";
  const helper =
    method === "totp"
      ? "Open your authenticator app and enter the 6 digit code."
      : "Enter one of the recovery codes you saved at enrollment.";
  const switchLabel =
    method === "totp" ? "Use a recovery code instead" : "Use your authenticator code";

  return (
    <AuthShell>
      <div
        className="mb-6 opacity-0"
        style={{ animation: "auth-slide-up 0.5s ease-out 0.1s forwards" }}
      >
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Two factor authentication
        </h2>
        <p className="mt-1.5 text-sm font-medium text-muted-foreground">{helper}</p>
      </div>

      {error && (
        <div
          className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm text-destructive"
          style={{ animation: "auth-fade-in 0.2s ease-out" }}
          data-testid="auth-error-banner"
        >
          <svg className="h-4 w-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM8 12a1 1 0 100-2 1 1 0 000 2z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <div
        className="opacity-0"
        style={{ animation: "auth-slide-up 0.5s ease-out 0.25s forwards" }}
      >
        <form onSubmit={submit} className="space-y-4" data-testid="auth-form-mfa">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => {
              const raw = e.target.value;
              setCode(method === "totp" ? raw.replace(/\D+/g, "").slice(0, 6) : raw);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            autoComplete="one-time-code"
            inputMode={method === "totp" ? "numeric" : "text"}
            pattern={method === "totp" ? "[0-9]{6}" : undefined}
            maxLength={method === "totp" ? 6 : undefined}
            spellCheck={false}
            required
            className={`
                            w-full rounded-lg border bg-background outline-none
                            text-foreground transition-all duration-200
                            px-4 py-3.5
                            ${
                              method === "totp"
                                ? "text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-muted-foreground/40"
                                : "font-mono text-sm tracking-widest placeholder:text-muted-foreground/40"
                            }
                            ${!focused ? "border-border hover:border-muted-foreground/40" : ""}
                        `}
            style={
              focused
                ? {
                    borderColor: BRAND_ACCENT,
                    boxShadow: `0 0 0 2px ${BRAND_ACCENT_RING}, 0 1px 2px 0 rgba(0,0,0,0.05)`,
                  }
                : undefined
            }
            data-testid="auth-input-mfa-code"
          />

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="auth-btn w-full mt-2 h-11 text-sm font-semibold tracking-wide rounded-lg cursor-pointer transition-colors duration-200"
            data-testid="auth-submit-mfa"
            data-loading={loading ? "true" : "false"}
          >
            {loading ? (
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
                Verifying...
              </span>
            ) : (
              "Continue"
            )}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setMethod(method === "totp" ? "recovery_code" : "totp");
              setCode("");
              setError(null);
            }}
            className="font-medium hover:underline cursor-pointer"
            style={{ color: BRAND_ACCENT }}
            data-testid="auth-mfa-toggle-method"
          >
            {switchLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            data-testid="auth-mfa-cancel"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
