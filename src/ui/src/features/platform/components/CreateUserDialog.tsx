import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { friendlyErrorMessage } from "@/config";
import { platformOrgsApi, platformUsersApi } from "@/features/platform/api/systemDirectoryApi";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const NO_ORG = "";

const ROLE_OPTIONS = [
  { value: "MEMBER", label: "Member" },
  { value: "ADMIN", label: "Admin" },
  { value: "OWNER", label: "Owner" },
];

function usernameFrom(email: string): string {
  return email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "");
}

function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CreateUserDialog({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [emailVerified, setEmailVerified] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [organizationId, setOrganizationId] = useState(NO_ORG);
  const [role, setRole] = useState("MEMBER");
  const [reason, setReason] = useState("");
  const [orgOptions, setOrgOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    platformOrgsApi
      .list({ page: 0, pageSize: 200 })
      .then((response) => {
        setOrgOptions([
          { value: NO_ORG, label: "No organization" },
          ...response.organizations.map((o) => ({
            value: o.id,
            label: o.name,
          })),
        ]);
      })
      .catch(() => {
        setOrgOptions([{ value: NO_ORG, label: "No organization" }]);
      });
  }, []);

  const effectiveUsername = usernameEdited ? username : usernameFrom(email);
  const canSubmit = email.trim().includes("@") && password.length >= 8 && reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await platformUsersApi.create({
        email: email.trim(),
        username: effectiveUsername,
        fullName: fullName.trim(),
        password,
        emailVerified,
        isSystemAdmin,
        organizationId,
        organizationRole: organizationId ? role : "",
        reason: reason.trim(),
      });
      toast.success(`Created ${email.trim()}`);
      onCreated();
      onClose();
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <ModalHeader
        title="New user"
        description="Direct provisioning, no invitation email. Hand the password over out of band."
      />

      <ModalBody>
        <div>
          <label htmlFor="user-create-email" className="block text-sm text-muted-foreground mb-1">
            Email
          </label>
          <Input
            id="user-create-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@acme.com"
            disabled={submitting}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="user-create-username"
              className="block text-sm text-muted-foreground mb-1"
            >
              Username
            </label>
            <Input
              id="user-create-username"
              value={effectiveUsername}
              onChange={(e) => {
                setUsernameEdited(true);
                setUsername(e.target.value.toLowerCase());
              }}
              placeholder="jane"
              className="font-mono"
              disabled={submitting}
            />
          </div>
          <div>
            <label htmlFor="user-create-name" className="block text-sm text-muted-foreground mb-1">
              Full name
            </label>
            <Input
              id="user-create-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              disabled={submitting}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="user-create-password"
            className="block text-sm text-muted-foreground mb-1"
          >
            Password
          </label>
          <div className="flex gap-2">
            <Input
              id="user-create-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="12+ characters"
              className="font-mono"
              disabled={submitting}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setPassword(generatePassword())}
              disabled={submitting}
              aria-label="Generate password"
            >
              <ArrowsClockwise size={14} weight="bold" />
              Generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            12+ characters, or 8-11 mixing case, digits and symbols.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Organization</label>
            <Select
              value={organizationId}
              onChange={setOrganizationId}
              options={orgOptions}
              disabled={submitting}
              ariaLabel="Organization"
            />
          </div>
          {organizationId !== NO_ORG && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Org role</label>
              <Select
                value={role}
                onChange={setRole}
                options={ROLE_OPTIONS}
                disabled={submitting}
                ariaLabel="Organization role"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Checkbox
            label="Email verified"
            checked={emailVerified}
            onChange={(e) => setEmailVerified(e.target.checked)}
            disabled={submitting}
          />
          <Checkbox
            label="System admin (platform operator)"
            checked={isSystemAdmin}
            onChange={(e) => setIsSystemAdmin(e.target.checked)}
            disabled={submitting}
          />
        </div>

        <div>
          <label htmlFor="user-create-reason" className="block text-sm text-muted-foreground mb-1">
            Reason
          </label>
          <Input
            id="user-create-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this account is being provisioned"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Recorded in the audit log alongside the new account.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Two-factor enrollment happens at first sign-in when the organization's security policy
          requires it.
        </p>
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting || !canSubmit}
        >
          Create user
        </Button>
      </ModalFooter>
    </Modal>
  );
}
