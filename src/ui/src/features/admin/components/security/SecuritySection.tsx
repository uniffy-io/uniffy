import { useCallback, useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { LockKey, Warning, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { securityApi } from "@/features/admin/api/securityApi";
import { friendlyErrorMessage } from "@/config";
import type { SecuritySettings } from "@uniffy/proto/organizations/v1/organizations_pb";

export function SecuritySection() {
  useDocumentTitle("Authentication");
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await securityApi.get({ organizationId });
      setSettings(response.settings ?? null);
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not load security settings";
      setError(friendly);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const togglePasswordReset = (enabled: boolean) =>
    applyChange(
      "password_reset_enabled",
      { passwordResetEnabled: enabled },
      enabled
        ? "Password reset enabled for this organization"
        : "Password reset disabled for this organization",
    );

  const toggleMfaMembers = (enabled: boolean) =>
    applyChange(
      "mfa_required_for_members",
      { mfaRequiredForMembers: enabled },
      enabled ? "MFA now required for every member" : "MFA no longer required for members",
    );

  const toggleMfaAdmins = (enabled: boolean) =>
    applyChange(
      "mfa_required_for_admins",
      { mfaRequiredForAdmins: enabled },
      enabled
        ? "MFA now required for organization admins"
        : "MFA no longer required for organization admins",
    );

  const applyChange = async (
    key: string,
    patch: Partial<{
      passwordResetEnabled: boolean;
      mfaRequiredForMembers: boolean;
      mfaRequiredForAdmins: boolean;
    }>,
    successMessage: string,
  ) => {
    if (!organizationId || !settings || savingKey) return;
    setSavingKey(key);
    try {
      const response = await securityApi.update({
        organizationId,
        ...patch,
      });
      setSettings(response.settings ?? null);
      toast.success(successMessage);
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not update security settings";
      toast.error(friendly);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <LockKey size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Authentication</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Control how members of this organization authenticate. More options (MFA, SSO, session
          policy) will land here.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border status-error">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !settings ? (
        <div className="rounded-xl bg-surface shadow-edge p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl bg-surface shadow-edge divide-y divide-border">
          <ToggleRow
            title="Password reset"
            description="Allow members to request a password reset link by email. Disable when this organization is SSO-only or requires admin-managed credential rotation."
            enabled={settings.passwordResetEnabled}
            onChange={togglePasswordReset}
            disabled={!isAdmin || savingKey !== null}
            saving={savingKey === "password_reset_enabled"}
          />
          <ToggleRow
            title="Require MFA for admins"
            description="OWNER and ADMIN role members must have two factor authentication enabled. Recommended for any organization that holds production data."
            enabled={settings.mfaRequiredForAdmins}
            onChange={toggleMfaAdmins}
            disabled={!isAdmin || savingKey !== null}
            saving={savingKey === "mfa_required_for_admins"}
          />
          <ToggleRow
            title="Require MFA for all members"
            description="Every member must enrol two factor authentication. New members and members invited during the grace window will be prompted on first sign in."
            enabled={settings.mfaRequiredForMembers}
            onChange={toggleMfaMembers}
            disabled={!isAdmin || savingKey !== null}
            saving={savingKey === "mfa_required_for_members"}
          />
        </div>
      )}

      {!isAdmin && (
        <p className="text-xs text-muted-foreground">
          You need owner or admin role to change these settings.
        </p>
      )}
    </div>
  );
}

interface ToggleRowProps {
  title: string;
  description: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  saving: boolean;
}

function ToggleRow({ title, description, enabled, onChange, disabled, saving }: ToggleRowProps) {
  return (
    <div className="flex items-start gap-4 p-5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {enabled ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                            bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
            >
              <CheckCircle size={11} weight="fill" /> Enabled
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                            bg-muted text-muted-foreground"
            >
              Disabled
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <ToggleSwitch enabled={enabled} onChange={onChange} disabled={disabled || saving} />
    </div>
  );
}
