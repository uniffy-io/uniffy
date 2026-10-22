import type { OrganizationFields } from "@/features/admin/store/organizationThunks";
import { toSlug } from "@/shared/utils/slug";

export type OrganizationField = keyof OrganizationFields;

/**
 * The fields that differ from the saved ones, in the form the server stores them. Only a slug the
 * user edited is normalised, so a stored slug the current rules would rewrite reads as unchanged.
 */
export function changedOrganizationFields(
  saved: OrganizationFields,
  draft: OrganizationFields,
): Partial<OrganizationFields> {
  const changes: Partial<OrganizationFields> = {};
  const name = draft.name.trim();
  if (name !== saved.name) changes.name = name;
  if (draft.slug !== saved.slug) {
    const slug = toSlug(draft.slug);
    if (slug !== saved.slug) changes.slug = slug;
  }
  return changes;
}
