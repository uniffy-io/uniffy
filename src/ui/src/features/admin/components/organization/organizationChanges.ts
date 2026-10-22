import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch } from "@/app/store";
import { refreshAccessToken } from "@/config/api";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { adminApi } from "@/features/admin/api/adminApi";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";
import { toSlug } from "@/shared/utils/slug";

export interface OrganizationFields {
  name: string;
  slug: string;
}

export type OrganizationField = keyof OrganizationFields;

/** The fields that differ from the saved ones, in the form the server stores them. */
export function changedOrganizationFields(
  saved: OrganizationFields,
  draft: OrganizationFields,
): Partial<OrganizationFields> {
  const changes: Partial<OrganizationFields> = {};
  const name = draft.name.trim();
  const slug = toSlug(draft.slug);
  if (name !== saved.name) changes.name = name;
  if (slug !== saved.slug) changes.slug = slug;
  return changes;
}

export interface OrganizationFieldError {
  field: OrganizationField;
  message: string;
}

/** An INVALID_ARGUMENT that names a field renders under that input instead of in a toast. */
export function organizationFieldError(error: unknown): OrganizationFieldError | null {
  if (!(error instanceof ConnectError) || error.code !== Code.InvalidArgument) return null;
  const raw = error.rawMessage.toLowerCase();
  const field: OrganizationField | null =
    (raw.match(/'(name|slug)'/)?.[1] as OrganizationField | undefined) ??
    (/\bslug\b/.test(raw) ? "slug" : /\bname\b/.test(raw) ? "name" : null);
  if (!field) return null;
  const message = friendlyErrorMessage(error.message) ?? "This value is not valid.";
  return { field, message: message.charAt(0).toUpperCase() + message.slice(1) };
}

/**
 * Saves the changed fields and brings the rest of the tab along: the organization list feeds the
 * user menu and header, and a refresh puts the new slug into this tab's credentials.
 */
export async function saveOrganizationChanges(
  dispatch: AppDispatch,
  organizationId: string,
  changes: Partial<OrganizationFields>,
): Promise<OrganizationFields | null> {
  const response = await adminApi.updateOrganization({ organizationId, ...changes });
  if (changes.slug !== undefined) {
    // The refresh asks by organization id, so the rename cannot lose the grant. A failed refresh
    // only delays the new slug until the interceptor's next one; the save itself stands.
    await refreshAccessToken().catch((error: unknown) => {
      console.warn("[admin] refresh after slug change failed", error);
    });
  }
  void dispatch(fetchMyOrganizations());
  const organization = response.organization;
  return organization ? { name: organization.name, slug: organization.slug } : null;
}

/**
 * Hands the organization to another member. The previous owner's role changes, so a refresh puts it
 * into this tab's credentials and the organization list reloads for the user menu.
 */
export async function transferOrganizationOwnership(
  dispatch: AppDispatch,
  organizationId: string,
  newOwnerUserId: string,
): Promise<void> {
  await adminApi.transferOwnership({ organizationId, newOwnerUserId });
  await refreshAccessToken().catch((error: unknown) => {
    console.warn("[admin] refresh after ownership transfer failed", error);
  });
  void dispatch(fetchMyOrganizations());
}
