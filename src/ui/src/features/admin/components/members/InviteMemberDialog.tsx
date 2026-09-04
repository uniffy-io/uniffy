import { useState } from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { invitationsApi } from "@/features/admin/api/invitationsApi";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { friendlyErrorMessage } from "@/config";

const ROLE_OPTIONS = [
  { value: String(OrganizationRole.MEMBER), label: "Member" },
  { value: String(OrganizationRole.ADMIN), label: "Admin" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteMemberDialogProps {
  organizationId: string;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteMemberDialog({
  organizationId,
  onClose,
  onInvited,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [roleStr, setRoleStr] = useState(String(OrganizationRole.MEMBER));
  const [submitting, setSubmitting] = useState(false);

  const trimmed = email.trim();
  const canSubmit = !submitting && EMAIL_RE.test(trimmed);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await invitationsApi.invite({
        organizationId,
        email: trimmed,
        role: Number(roleStr) as OrganizationRole,
      });
      if (response.result.case === "addedMember") {
        const member = response.result.value;
        toast.success(`${member.displayName || trimmed} added to the organization`);
      } else {
        toast.success(`Invitation sent to ${trimmed}`);
      }
      onInvited();
      onClose();
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not send invitation";
      toast.error(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <ModalHeader
        title="Invite member"
        description="Existing accounts are added right away. Anyone else gets an invitation link by email."
      />

      <ModalBody>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            autoFocus
            disabled={submitting}
          />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Role</label>
          <Select
            value={roleStr}
            onChange={setRoleStr}
            options={ROLE_OPTIONS}
            disabled={submitting}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
          <PaperPlaneTilt size={16} weight="fill" />
          Send invitation
        </Button>
      </ModalFooter>
    </Modal>
  );
}
