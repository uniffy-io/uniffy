import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { friendlyErrorMessage } from "@/config";
import {
  deleteOrganization,
  type OrganizationFields,
} from "@/features/admin/store/organizationThunks";

const CONSEQUENCES = [
  "Everyone loses access now.",
  "The organization and its content are deleted after the purge window.",
  "A platform operator can restore it before then.",
];

interface DeleteOrganizationDialogProps {
  organizationId: string;
  organization: OrganizationFields;
  onClose: () => void;
}

export function DeleteOrganizationDialog({
  organizationId,
  organization,
  onClose,
}: DeleteOrganizationDialogProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmSlug.trim() === organization.slug;

  const remove = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    try {
      await dispatch(
        deleteOrganization({ organizationId, confirmSlug: confirmSlug.trim(), navigate }),
      );
    } catch (err) {
      const message = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
      if (message) toast.error(message);
      setDeleting(false);
      return;
    }
    toast.success(`${organization.name} was deleted.`);
  };

  return (
    <Modal onClose={onClose} closeDisabled={deleting} maxWidth="max-w-md">
      <ModalHeader title="Delete organization" description={organization.name} />

      <ModalBody>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {CONSEQUENCES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div>
          <label
            htmlFor="delete-organization-slug"
            className="mb-1 block text-sm text-muted-foreground"
          >
            Type <span className="font-mono text-foreground">{organization.slug}</span> to confirm
          </label>
          <Input
            id="delete-organization-slug"
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={deleting}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => void remove()}
          disabled={!confirmed}
          loading={deleting}
        >
          {deleting ? "Deleting..." : "Delete organization"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
