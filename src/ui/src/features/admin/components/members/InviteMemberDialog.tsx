import { useState } from "react";
import { PaperPlaneTilt, UserPlus, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <UserPlus size={20} weight="duotone" className="text-primary" />
          <h2 className="text-lg font-semibold">Invite member</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground disabled:opacity-40"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            autoFocus
            disabled={submitting}
            className="w-full px-3 py-2 rounded-md border border-border bg-background
                            text-sm focus:outline-none focus:ring-2 focus:ring-primary
                            disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            If the email already has an account, they will be added directly. Otherwise we will
            email them an invitation link.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Role</label>
          <Select
            value={roleStr}
            onChange={setRoleStr}
            options={ROLE_OPTIONS}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border bg-muted/30">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
          <PaperPlaneTilt size={16} weight="fill" />
          Send invitation
        </Button>
      </div>
    </Modal>
  );
}
