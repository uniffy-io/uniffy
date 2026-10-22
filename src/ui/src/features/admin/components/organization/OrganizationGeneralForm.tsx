import { useState } from "react";
import { toast } from "sonner";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/config";
import {
  changedOrganizationFields,
  organizationFieldError,
  saveOrganizationChanges,
  type OrganizationField,
  type OrganizationFields,
} from "@/features/admin/components/organization/organizationChanges";
import { MAX_SLUG_LENGTH, toSlugDraft } from "@/shared/utils/slug";

const MAX_NAME_LENGTH = 255;

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface OrganizationGeneralFormProps {
  organizationId: string;
  saved: OrganizationFields;
  onSaved: (fields: OrganizationFields) => void;
}

export function OrganizationGeneralForm({
  organizationId,
  saved,
  onSaved,
}: OrganizationGeneralFormProps) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<OrganizationFields>(saved);
  const [errors, setErrors] = useState<Partial<Record<OrganizationField, string>>>({});
  const [saving, setSaving] = useState(false);

  const changes = changedOrganizationFields(saved, draft);
  const isDirty = Object.keys(changes).length > 0;
  const slugChanged = changes.slug !== undefined;

  const edit = (field: OrganizationField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty || saving) return;
    setSaving(true);
    setErrors({});
    try {
      const result = (await saveOrganizationChanges(dispatch, organizationId, changes)) ?? {
        ...saved,
        ...changes,
      };
      setDraft(result);
      onSaved(result);
      toast.success("Organization updated");
    } catch (err) {
      const fieldError = organizationFieldError(err);
      if (fieldError) {
        setErrors({ [fieldError.field]: fieldError.message });
      } else {
        const message = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
        if (message) toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card tone="surface">
        <div className="space-y-5 p-4 md:p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">General</h2>
            <p className="text-sm text-muted-foreground">
              The name members see and the slug in links to this organization.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="organization-name" error={errors.name}>
              <Input
                id="organization-name"
                value={draft.name}
                onChange={(e) => edit("name", e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                disabled={saving}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "organization-name-error" : undefined}
              />
            </Field>

            <Field
              label="Slug"
              htmlFor="organization-slug"
              error={errors.slug}
              hint={
                slugChanged
                  ? "Changing the slug changes links into this organization. Old links stop working."
                  : undefined
              }
            >
              <Input
                id="organization-slug"
                value={draft.slug}
                onChange={(e) => edit("slug", toSlugDraft(e.target.value))}
                maxLength={MAX_SLUG_LENGTH}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={errors.slug ? "organization-slug-error" : undefined}
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end rounded-b-xl bg-background/60 px-4 py-3 md:px-6">
          <Button type="submit" size="md" disabled={!isDirty} loading={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
