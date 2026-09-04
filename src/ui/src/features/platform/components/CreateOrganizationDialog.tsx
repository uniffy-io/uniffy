import { useState } from "react";
import { toast } from "sonner";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { friendlyErrorMessage } from "@/config";
import { platformOrgsApi } from "@/features/platform/api/systemDirectoryApi";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const PLAN_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "team", label: "Team" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
];

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateOrganizationDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [plan, setPlan] = useState("free");
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugFrom(name);
  const canSubmit =
    name.trim().length > 0 && effectiveSlug.length >= 2 && ownerEmail.trim().includes("@");

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await platformOrgsApi.create({
        name: name.trim(),
        slug: effectiveSlug,
        ownerEmail: ownerEmail.trim(),
        plan,
        domain: domain.trim(),
      });
      toast.success(`Created ${name.trim()}`);
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
        title="New organization"
        description="Provisions a full workspace: owner membership, encryption key, default channel and agent."
      />

      <ModalBody>
        <div>
          <label htmlFor="org-create-name" className="block text-sm text-muted-foreground mb-1">
            Name
          </label>
          <Input
            id="org-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            placeholder="Acme Inc"
            disabled={submitting}
          />
        </div>

        <div>
          <label htmlFor="org-create-slug" className="block text-sm text-muted-foreground mb-1">
            Slug
          </label>
          <Input
            id="org-create-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(slugFrom(e.target.value));
            }}
            maxLength={255}
            placeholder="acme-inc"
            className="font-mono"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Unique across the deployment. Lowercase letters, digits and hyphens.
          </p>
        </div>

        <div>
          <label htmlFor="org-create-owner" className="block text-sm text-muted-foreground mb-1">
            Owner email
          </label>
          <Input
            id="org-create-owner"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@acme.com"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Must be an existing active user. They become the org owner.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Plan</label>
            <Select
              value={plan}
              onChange={setPlan}
              options={PLAN_OPTIONS}
              disabled={submitting}
              ariaLabel="Plan"
            />
          </div>
          <div>
            <label htmlFor="org-create-domain" className="block text-sm text-muted-foreground mb-1">
              Domain (optional)
            </label>
            <Input
              id="org-create-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com"
              className="font-mono"
              disabled={submitting}
            />
          </div>
        </div>
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
          Create organization
        </Button>
      </ModalFooter>
    </Modal>
  );
}
