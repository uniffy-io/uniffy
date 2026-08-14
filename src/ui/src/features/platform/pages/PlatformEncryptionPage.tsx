import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Key, ArrowsClockwise, ShieldCheck, Warning } from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/config";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";
import { systemEncryptionApi } from "@/features/platform/api/systemEncryptionApi";
import type { DeploymentEncryptionStatus } from "@uniffy/proto/superadmin/v1/system_encryption_pb";

export function PlatformEncryptionPage() {
  useDocumentTitle("Platform Encryption");
  const [status, setStatus] = useState<DeploymentEncryptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateReason, setRotateReason] = useState("");
  const [rotateBusy, setRotateBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await systemEncryptionApi.getDeploymentEncryptionStatus({});
      setStatus(response.status ?? null);
    } catch (err) {
      const friendly = friendlyErrorMessage((err as Error).message);
      if (friendly) toast.error(friendly);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRotate = async () => {
    if (!rotateReason.trim()) {
      toast.error("Reason is required");
      return;
    }
    setRotateBusy(true);
    try {
      const response = await systemEncryptionApi.rotateDeploymentDek({
        reason: rotateReason.trim(),
      });
      toast.success(`Rotated to version v${response.newActiveVersion}`);
      setRotateOpen(false);
      setRotateReason("");
      await load();
    } catch (err) {
      const friendly = friendlyErrorMessage((err as Error).message);
      if (friendly) toast.error(friendly);
    } finally {
      setRotateBusy(false);
    }
  };

  const activeVersion = status?.activeVersion ?? 0;
  const provisioned = activeVersion > 0;
  const retiredCount = Math.max(0, (status?.totalVersions ?? 0) - (provisioned ? 1 : 0));

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Key size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">Encryption</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Deployment-scope Data Encryption Key (DEK) wrapped by the master KEK from env. Used to
            encrypt operator-managed secrets in{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
              deployment_settings
            </code>{" "}
            (system SMTP password today, future deployment-scope secrets automatically).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat
              icon={<ShieldCheck size={18} weight="duotone" />}
              label="Active version"
              value={provisioned ? `v${activeVersion}` : "Not provisioned"}
              tone={provisioned ? "ok" : "muted"}
            />
            <Stat
              icon={<Key size={18} weight="duotone" />}
              label="Retired versions"
              value={String(retiredCount)}
              tone="muted"
            />
            <Stat
              icon={<ArrowsClockwise size={18} weight="duotone" />}
              label="Active since"
              value={status?.activeCreatedAt ? formatProtoDateTime(status.activeCreatedAt) : "—"}
              tone="muted"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4 md:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <ArrowsClockwise
                size={20}
                weight="duotone"
                className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Rotate the deployment DEK</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Generates a fresh DEK, retires the active row, re-encrypts every registered
                  deployment-scope secret under the new key, and publishes a cache invalidation so
                  every pod drops the retired Fernet. The retired DEK row stays in the table so
                  historical ciphertext (if any) keeps decrypting until the sweep finishes.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <Button size="sm" variant="ghost" onClick={() => void load()}>
                Refresh
              </Button>
              <Button size="sm" onClick={() => setRotateOpen(true)} disabled={!provisioned}>
                Rotate
              </Button>
            </div>
            {!provisioned && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Warning size={12} weight="duotone" />
                The DEK self-provisions on the first encrypt call. Save the system mail config or
                any other deployment-scope secret to provision v1.
              </p>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={rotateOpen}
        onClose={() => {
          if (!rotateBusy) setRotateOpen(false);
        }}
        onConfirm={() => void handleRotate()}
        title={`Rotate deployment DEK from v${activeVersion} to v${activeVersion + 1}?`}
        message={
          <div className="space-y-3">
            <p>
              Re-encrypts every <code className="font-mono">deployment_settings</code> secret under
              the new DEK. Action is audit-logged.
            </p>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Reason</label>
              <input
                type="text"
                value={rotateReason}
                onChange={(e) => setRotateReason(e.target.value)}
                placeholder="e.g. scheduled quarterly rotation"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        }
        confirmLabel={rotateBusy ? "Rotating..." : "Rotate"}
        cancelLabel="Cancel"
        variant="warning"
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div
        className={
          "flex items-center gap-1.5 text-xs " +
          (tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")
        }
      >
        {icon}
        <span className="uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}
