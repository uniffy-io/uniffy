import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import { ONBOARDING_PATH } from "@/features/onboarding/hooks/useOnboardingRedirect";
import { createOrganization } from "@/features/auth/store/organizationsThunks";
import { fieldErrorFor, MAX_ORGANIZATION_NAME_LENGTH } from "@/features/auth/utils/fieldErrors";
import { MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, toSlug, toSlugDraft } from "@/shared/utils/slug";

const FIELDS = ["name", "slug"] as const;
const CREATION_NOT_ALLOWED = "Organization creation is not allowed for this account.";

interface FieldErrors {
  name?: string;
  slug?: string;
  form?: string;
}

/** Places a refused create on the field its message names, or on the form for policy and limits. */
function fieldErrorsFor(error: ConnectError): FieldErrors | null {
  const placed = fieldErrorFor(error, FIELDS);
  if (placed) return { [placed.field]: placed.message };
  if (error.code === Code.PermissionDenied) return { form: CREATION_NOT_ALLOWED };
  if (error.code === Code.ResourceExhausted) {
    const message = friendlyErrorMessage(error.message);
    return message ? { form: message } : null;
  }
  return null;
}

interface CreateOrganizationDialogProps {
  onClose: () => void;
}

export function CreateOrganizationDialog({ onClose }: CreateOrganizationDialogProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { guardSwitch, isSwitching, confirmDialog } = useSwitchOrganization();
  const [name, setName] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const shownSlug = slugEdited ? slugDraft : toSlug(name);
  const slug = toSlug(shownSlug);
  const busy = submitting || isSwitching;
  const canSubmit = name.trim().length > 0 && slug.length >= MIN_SLUG_LENGTH && !busy;

  const create = async () => {
    setSubmitting(true);
    setErrors({});
    try {
      await dispatch(createOrganization({ name: name.trim(), slug }));
      onClose();
      // The entry flow greets the new owner; it hands off to the dashboard when not pending.
      navigate(ONBOARDING_PATH, { replace: true });
    } catch (error) {
      setSubmitting(false);
      // The organization exists and is listed; only the switch into it failed, and it toasted.
      if (!(error instanceof ConnectError)) {
        onClose();
        return;
      }
      const placed = fieldErrorsFor(error);
      if (placed) {
        setErrors(placed);
        return;
      }
      const message = friendlyErrorMessage(error.message);
      if (message) toast.error(message);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void guardSwitch(create);
  };

  return (
    <>
      <Modal onClose={onClose} closeDisabled={busy} maxWidth="max-w-md">
        <form onSubmit={handleSubmit} data-testid="create-organization-dialog">
          <ModalHeader
            title="Create an organization"
            description="You become its owner and can invite people once you are in."
          />

          <ModalBody>
            <div>
              <label htmlFor="create-org-name" className="block text-sm text-muted-foreground mb-1">
                Name
              </label>
              <Input
                id="create-org-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined, form: undefined }));
                }}
                maxLength={MAX_ORGANIZATION_NAME_LENGTH}
                placeholder="Acme Inc"
                autoFocus
                disabled={busy}
                aria-invalid={errors.name ? "true" : undefined}
                aria-describedby={errors.name ? "create-org-name-error" : undefined}
                data-testid="create-organization-name"
              />
              {errors.name && (
                <p
                  id="create-org-name-error"
                  className="text-xs text-destructive mt-1"
                  role="alert"
                >
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="create-org-slug" className="block text-sm text-muted-foreground mb-1">
                Slug
              </label>
              <Input
                id="create-org-slug"
                value={shownSlug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlugDraft(toSlugDraft(event.target.value));
                  setErrors((current) => ({ ...current, slug: undefined, form: undefined }));
                }}
                maxLength={MAX_SLUG_LENGTH}
                placeholder="acme-inc"
                className="font-mono"
                disabled={busy}
                aria-invalid={errors.slug ? "true" : undefined}
                aria-describedby={errors.slug ? "create-org-slug-error" : undefined}
                data-testid="create-organization-slug"
              />
              {errors.slug && (
                <p
                  id="create-org-slug-error"
                  className="text-xs text-destructive mt-1"
                  role="alert"
                >
                  {errors.slug}
                </p>
              )}
            </div>

            {errors.form && (
              <p className="text-sm text-destructive" role="alert">
                {errors.form}
              </p>
            )}
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={!canSubmit}
              data-testid="create-organization-submit"
            >
              Create organization
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      {confirmDialog}
    </>
  );
}
