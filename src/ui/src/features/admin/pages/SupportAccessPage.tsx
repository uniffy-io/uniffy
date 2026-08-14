import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Lifebuoy, ShieldCheck, Info, Lock } from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";
import { friendlyErrorMessage } from "@/config";
import { supportConsentApi } from "@/features/admin/api/supportConsentApi";
import {
  SupportConsentMode,
  type SupportConsentModeView,
} from "@uniffy/proto/support/v1/support_consent_pb";

function modeLabel(mode: SupportConsentMode): string {
  switch (mode) {
    case SupportConsentMode.OWNER_APPROVED:
      return "Owner approval required";
    case SupportConsentMode.OPERATOR_JUSTIFIED:
      return "Operator-justified";
    default:
      return "Not set";
  }
}

function modeDescription(mode: SupportConsentMode): string {
  switch (mode) {
    case SupportConsentMode.OWNER_APPROVED:
      return "Platform operators cannot enter your workspace without an org admin clicking Approve first. Recommended for most workspaces.";
    case SupportConsentMode.OPERATOR_JUSTIFIED:
      return "Sessions go ACTIVE immediately when an operator opens one, with an in-app banner + email letting you revoke at any time. Faster for single-operator self-hosted setups.";
    default:
      return "Falls back to the deployment-wide policy.";
  }
}

export function SupportAccessPage() {
  useDocumentTitle("Support access");
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const [view, setView] = useState<SupportConsentModeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const response = await supportConsentApi.getOrgConsentMode({
        organizationId,
      });
      setView(response.view ?? null);
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSet = async (mode: SupportConsentMode) => {
    if (!organizationId) return;
    setSubmitting(true);
    try {
      const response = await supportConsentApi.setOrgConsentMode({
        organizationId,
        mode,
      });
      setView(response.view ?? null);
      toast.success("Support access policy updated");
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !view) {
    return <div className="text-sm text-muted-foreground p-4">Loading...</div>;
  }

  const locked = view.lockedByDeployment;
  const ownerApprovedValue = SupportConsentMode.OWNER_APPROVED;
  const operatorJustifiedValue = SupportConsentMode.OPERATOR_JUSTIFIED;
  const unspecified = SupportConsentMode.UNSPECIFIED;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Lifebuoy size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">Support access</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control how platform operators can request time-bound access to this workspace.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck size={16} weight="duotone" />
          Current policy
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Deployment default
            </div>
            <div className="text-sm font-medium mt-1">{modeLabel(view.deploymentMode)}</div>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Org override
            </div>
            <div className="text-sm font-medium mt-1">
              {view.orgOverride === unspecified ? "Not set" : modeLabel(view.orgOverride)}
            </div>
          </div>
          <div className="rounded-md bg-primary/10 border border-primary/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-primary">Effective</div>
            <div className="text-sm font-medium mt-1">{modeLabel(view.effective)}</div>
          </div>
        </div>
      </div>

      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
          <Lock size={14} weight="duotone" className="shrink-0 mt-0.5" />
          <div>
            This deployment requires owner approval for every support session. You cannot loosen the
            policy from this page; the deployment operator controls it via env.
          </div>
        </div>
      )}

      <div className="space-y-3">
        <PolicyChoice
          title="Owner approval required"
          description={modeDescription(ownerApprovedValue)}
          active={view.effective === ownerApprovedValue}
          disabled={submitting || (locked && view.effective === ownerApprovedValue)}
          onClick={() => handleSet(ownerApprovedValue)}
        />
        <PolicyChoice
          title="Operator-justified"
          description={modeDescription(operatorJustifiedValue)}
          active={view.effective === operatorJustifiedValue}
          disabled={submitting || locked}
          onClick={() => handleSet(operatorJustifiedValue)}
        />
        {view.orgOverride !== unspecified && (
          <Button
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => handleSet(unspecified)}
          >
            Clear org override (fall back to deployment default)
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info size={14} weight="duotone" className="shrink-0 mt-0.5" />
        <div>
          Regardless of policy, every action a platform operator takes during a session is recorded
          in your audit log under{" "}
          <code className="px-1 rounded bg-background/60">actor_kind=support</code>. The org owner
          is always notified when a session starts and can revoke at any time.
        </div>
      </div>
    </div>
  );
}

interface PolicyChoiceProps {
  title: string;
  description: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

function PolicyChoice({ title, description, active, disabled, onClick }: PolicyChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "h-4 w-4 rounded-full border-2 mt-0.5 shrink-0",
            active ? "border-primary bg-primary" : "border-muted-foreground",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground mt-1">{description}</div>
        </div>
      </div>
    </button>
  );
}
