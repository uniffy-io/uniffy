import { useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
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
// The one conflict an invite reports: the address belongs to an active member already.
const ALREADY_MEMBER = "This person is already a member of the organization.";

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
  const [emailError, setEmailError] = useState<string | null>(null);

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
      toast.success(`Invitation sent to ${response.invitation?.email || trimmed}.`);
      onInvited();
      onClose();
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        setEmailError(ALREADY_MEMBER);
        return;
      }
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
        description="The person gets an invitation by email. They join once they accept it."
      />

      <ModalBody>
        <div>
          <label htmlFor="invite-member-email" className="block text-sm text-muted-foreground mb-1">
            Email
          </label>
          <Input
            id="invite-member-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            placeholder="person@example.com"
            autoFocus
            disabled={submitting}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "invite-member-email-error" : undefined}
          />
          {emailError && (
            <p
              id="invite-member-email-error"
              className="mt-1.5 text-xs text-destructive"
              role="alert"
            >
              {emailError}
            </p>
          )}
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
