import { useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar, SubjectPicker, type Subject } from "@/components/subject";
import { Button } from "@/components/ui/button";
import { controlShellClass } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { friendlyErrorMessage } from "@/config";
import { transferOrganizationOwnership } from "@/features/admin/store/organizationThunks";
import { cn } from "@/shared/utils/cn";

/** A refusal that names its reason, such as a new owner whose account is inactive. */
function refusalMessage(error: unknown): string | null {
  if (!(error instanceof ConnectError) || error.code !== Code.PermissionDenied) return null;
  return error.rawMessage || null;
}

interface OwnershipTransferDialogProps {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onTransferred: () => void;
}

export function OwnershipTransferDialog({
  organizationId,
  organizationName,
  onClose,
  onTransferred,
}: OwnershipTransferDialogProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? null);
  const [selected, setSelected] = useState<Subject | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Only the owner opens this dialog, so leaving out the current user leaves out the owner.
  const excludeIds = currentUserId ? [currentUserId] : [];

  const pick = (subject: Subject | null) => {
    setSelected(subject);
    setRefusal(null);
  };

  const transfer = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      await dispatch(transferOrganizationOwnership(organizationId, selected.id));
      toast.success(`${selected.name} now owns ${organizationName}.`);
      onTransferred();
    } catch (err) {
      setSubmitting(false);
      const message = refusalMessage(err);
      if (message) {
        setRefusal(message);
        return;
      }
      const friendly = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
      if (friendly) toast.error(friendly);
    }
  };

  const refusalNotice = refusal && (
    <p className="text-sm text-destructive" role="alert">
      {refusal}
    </p>
  );

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-lg">
      <ModalHeader
        title="Transfer ownership"
        description={confirming ? undefined : `Pick the member who will own ${organizationName}.`}
      />

      {confirming && selected ? (
        <ModalBody>
          <p className="text-sm text-foreground">
            {selected.name} becomes the owner. You stay as an admin.
          </p>
          <p className="text-sm text-muted-foreground">
            Only the owner can transfer ownership or delete the organization.
          </p>
          {refusalNotice}
        </ModalBody>
      ) : (
        <ModalBody>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">New owner</label>
            {selected ? (
              <div
                className={cn(
                  controlShellClass,
                  "hover:border-border flex items-center gap-2.5 px-3 py-2",
                )}
              >
                <SubjectAvatar subject={selected} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{selected.name}</p>
                  {selected.email && (
                    <p className="truncate text-xs text-muted-foreground">{selected.email}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Pick another member"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ) : (
              // The picker's results float below its search box; the height keeps them in view.
              <div className="min-h-64">
                <SubjectPicker
                  mode="single"
                  subjectTypes="users"
                  value={[]}
                  excludeIds={excludeIds}
                  onChange={(_ids, subjects) => pick(subjects[0] ?? null)}
                  placeholder="Search members..."
                  autoFocus
                />
              </div>
            )}
          </div>
          {refusalNotice}
        </ModalBody>
      )}

      <ModalFooter>
        {confirming ? (
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
              Back
            </Button>
            <Button
              variant="warning"
              onClick={() => void transfer()}
              disabled={refusal !== null}
              loading={submitting}
            >
              {submitting ? "Transferring..." : "Transfer ownership"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!selected || refusal !== null}>
              Continue
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
