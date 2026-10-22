import { timestampDate } from "@bufbuild/protobuf/wkt";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type {
  ListMyInvitationsResponse,
  ListMyOrganizationsResponse,
} from "@uniffy/proto/organizations/v1/organizations_pb";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  suspended: boolean;
};

export type InvitationSummary = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  inviterDisplayName: string | null;
  expiresAt: Date;
};

const ROLE_LABELS: Partial<Record<OrganizationRole, string>> = {
  [OrganizationRole.OWNER]: "Owner",
  [OrganizationRole.ADMIN]: "Admin",
  [OrganizationRole.MEMBER]: "Member",
};

export function organizationRoleLabel(role: OrganizationRole): string {
  return ROLE_LABELS[role] ?? "Member";
}

export function toOrganizationSummaries(
  response: ListMyOrganizationsResponse,
): OrganizationSummary[] {
  return response.organizations
    .flatMap(({ organization, role, suspended }) =>
      organization
        ? [
            {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              role,
              suspended,
            },
          ]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function canCreateOrganization(response: ListMyOrganizationsResponse): boolean {
  return response.canCreateOrganization;
}

export function toInvitationSummaries(response: ListMyInvitationsResponse): InvitationSummary[] {
  return response.invitations
    .flatMap(({ id, organization, role, inviterDisplayName, expiresAt }) =>
      organization && expiresAt
        ? [
            {
              id,
              organizationId: organization.id,
              organizationName: organization.name,
              organizationSlug: organization.slug,
              role,
              inviterDisplayName: inviterDisplayName?.trim() || null,
              expiresAt: timestampDate(expiresAt),
            },
          ]
        : [],
    )
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName));
}
