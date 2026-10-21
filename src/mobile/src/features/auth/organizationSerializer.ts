import type { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { ListMyOrganizationsResponse } from "@uniffy/proto/organizations/v1/organizations_pb";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  suspended: boolean;
};

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
