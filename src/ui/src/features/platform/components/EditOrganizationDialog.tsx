import { useState } from "react";
import { toast } from "sonner";
import { PencilSimple, X } from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { friendlyErrorMessage } from "@/config";
import { platformOrgsApi } from "@/features/platform/api/systemDirectoryApi";
import type { PlatformOrganizationDetail } from "@uniffy/proto/superadmin/v1/system_directory_pb";

interface Props {
  detail: PlatformOrganizationDetail;
  onClose: () => void;
  onSaved: () => void;
}

const KNOWN_PLANS = ["free", "pro", "team", "business", "enterprise"];

function slugFrom(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-+/, "");
}

export function EditOrganizationDialog({ detail, onClose, onSaved }: Props) {
  const summary = detail.summary;
  const [name, setName] = useState(summary?.name ?? "");
  const [slug, setSlug] = useState(summary?.slug ?? "");
  const [domain, setDomain] = useState(detail.domain ?? "");
  const [plan, setPlan] = useState(summary?.plan ?? "free");
  const [maxMembers, setMaxMembers] = useState(
    detail.maxMembers !== undefined ? String(detail.maxMembers) : "",
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!summary) return null;

  const planOptions = (
    KNOWN_PLANS.includes(summary.plan) ? KNOWN_PLANS : [summary.plan, ...KNOWN_PLANS]
  ).map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

  const parsedMax = maxMembers.trim() === "" ? 0 : Number(maxMembers);
  const maxValid = Number.isInteger(parsedMax) && parsedMax >= 0 && parsedMax <= 1_000_000;

  const changes: {
    name?: string;
    slug?: string;
    domain?: string;
    plan?: string;
    maxMembers?: number;
  } = {};
  if (name.trim() !== summary.name) changes.name = name.trim();
  if (slug !== summary.slug) changes.slug = slug;
  if (domain.trim().toLowerCase() !== (detail.domain ?? "")) {
    changes.domain = domain.trim().toLowerCase();
  }
  if (plan !== summary.plan) changes.plan = plan;
  if (maxValid && parsedMax !== (detail.maxMembers ?? 0)) {
    changes.maxMembers = parsedMax;
  }

  const hasChanges = Object.keys(changes).length > 0;
  const canSubmit =
    hasChanges &&
    reason.trim().length > 0 &&
    name.trim().length > 0 &&
    slug.length >= 2 &&
    maxValid;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await platformOrgsApi.update({
        organizationId: summary.id,
        reason: reason.trim(),
        ...changes,
      });
      toast.success(`Updated ${summary.name}`);
      onSaved();
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
      <div className="flex items-start gap-3 p-4 border-b border-border">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <PencilSimple size={20} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-foreground">Edit organization settings</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{summary.name}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label
            htmlFor="org-edit-name"
            className="text-xs font-medium text-muted-foreground block mb-1"
          >
            Name
          </label>
          <Input
            id="org-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            disabled={submitting}
          />
        </div>

        <div>
          <label
            htmlFor="org-edit-slug"
            className="text-xs font-medium text-muted-foreground block mb-1"
          >
            Slug
          </label>
          <Input
            id="org-edit-slug"
            value={slug}
            onChange={(e) => setSlug(slugFrom(e.target.value))}
            maxLength={255}
            className="font-mono"
            disabled={submitting}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Changing the slug breaks existing links that embed it.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Plan</label>
            <Select
              value={plan}
              onChange={setPlan}
              options={planOptions}
              disabled={submitting}
              ariaLabel="Plan"
            />
          </div>
          <div>
            <label
              htmlFor="org-edit-max-members"
              className="text-xs font-medium text-muted-foreground block mb-1"
            >
              Member cap
            </label>
            <NumberInput
              id="org-edit-max-members"
              min={0}
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              placeholder="No cap"
              disabled={submitting}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="org-edit-domain"
            className="text-xs font-medium text-muted-foreground block mb-1"
          >
            Domain
          </label>
          <Input
            id="org-edit-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            className="font-mono"
            disabled={submitting}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Recorded as the org's primary mail domain. Nothing matches on it today. Leave empty to
            clear.
          </p>
        </div>

        <div>
          <label
            htmlFor="org-edit-reason"
            className="text-xs font-medium text-muted-foreground block mb-1"
          >
            Reason
          </label>
          <textarea
            id="org-edit-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="e.g. Ticket #1234 - plan upgrade after purchase"
            className="w-full bg-input border border-border rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
        <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="md"
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
        >
          <PencilSimple size={14} weight="duotone" />
          Save changes
        </Button>
      </div>
    </Modal>
  );
}
