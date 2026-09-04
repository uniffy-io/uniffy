import { useState } from "react";
import { Key, Warning, CheckCircle, ShieldCheck } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { rotateEncryptionKey } from "@/features/admin/store/adminThunks";
import type { EncryptionRotationResult } from "@/features/admin/store/adminThunks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { toast } from "sonner";

export function EncryptionSection() {
  const dispatch = useAppDispatch();
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isOwner = role === "OWNER";

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [lastResult, setLastResult] = useState<EncryptionRotationResult | null>(null);

  const handleConfirm = async () => {
    setRotating(true);
    try {
      const result = await dispatch(rotateEncryptionKey()).unwrap();
      setLastResult(result);
      setConfirmOpen(false);
      toast.success(`Encryption key rotated to v${result.newVersion}`);
    } catch {
      // errorToastMiddleware surfaces the message to the user
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <ShieldCheck size={22} weight="duotone" className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Encryption</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage this organization's at-rest encryption key.
          </p>
        </div>
      </div>

      <div className="p-5 rounded-xl bg-surface shadow-edge flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Key size={20} weight="duotone" className="text-primary mt-0.5" />
          <div className="flex-1">
            <h2 className="font-medium text-foreground">Data Encryption Key</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Every protected secret in this organization (AI provider keys, future mail
              credentials) is encrypted with a key unique to this workspace. The key itself is
              wrapped by the deployment-wide master key.
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="font-medium text-foreground mb-1">Rotate the key</h3>
          <p className="text-sm text-muted-foreground">
            Generates a fresh key, re-encrypts every secret under it, and retires the previous
            version. Existing requests keep working during the sweep. Use this when a credential is
            suspected to have leaked or as a periodic hygiene step.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              variant="default"
              onClick={() => setConfirmOpen(true)}
              disabled={!isOwner || rotating}
            >
              <Key size={16} weight="bold" />
              Rotate Encryption Key
            </Button>
            {!isOwner && (
              <span className="text-xs text-muted-foreground">
                Only the organization owner can rotate the encryption key.
              </span>
            )}
          </div>

          {lastResult && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-md border border-border bg-muted/40">
              <CheckCircle
                size={18}
                weight="duotone"
                className="text-emerald-600 dark:text-emerald-400 mt-0.5"
              />
              <div className="text-sm">
                <p className="font-medium text-foreground">Rotated to v{lastResult.newVersion}</p>
                <p className="text-muted-foreground">
                  Previous version v{lastResult.previousVersion} retired{" "}
                  {formatRelativeTime(new Date(lastResult.rotatedAtSeconds * 1000).toISOString())}.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
        <Warning
          size={18}
          weight="duotone"
          className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
        />
        <div className="text-sm">
          <p className="font-medium text-foreground">Losing the master key is unrecoverable.</p>
          <p className="text-muted-foreground mt-1">
            On a self-hosted deployment, the administrator is responsible for storing the master key
            separately from the database. On Uniffy Cloud, we manage the key on your behalf in our
            secrets platform.
          </p>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => (rotating ? undefined : setConfirmOpen(false))}
        onConfirm={handleConfirm}
        title="Rotate encryption key?"
        variant="warning"
        confirmLabel={rotating ? "Rotating..." : "Rotate now"}
        loading={rotating}
        message={
          <div className="flex flex-col gap-2">
            <p>
              Uniffy will generate a new Data Encryption Key for this organization, re-encrypt every
              protected secret under it, and retire the current key.
            </p>
            <p>Existing requests continue to work during the sweep. This action is audit-logged.</p>
          </div>
        }
      />
    </div>
  );
}
