import { create } from "@bufbuild/protobuf";
import { OrganizationInfoSchema, OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import {
  ListMyOrganizationsResponseSchema,
  MyOrganizationSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import { describe, expect, it } from "vitest";
import { toOrganizationSummaries } from "@features/auth/organizationSerializer";

function membership(id: string, name: string, role: OrganizationRole, suspended = false) {
  return create(MyOrganizationSchema, {
    organization: create(OrganizationInfoSchema, { id, name, slug: name.toLowerCase() }),
    role,
    suspended,
  });
}

describe("toOrganizationSummaries", () => {
  it("maps each membership to its organization, role and suspension, sorted by name", () => {
    const response = create(ListMyOrganizationsResponseSchema, {
      organizations: [
        membership("org-g", "Globex", OrganizationRole.MEMBER, true),
        membership("org-a", "Acme", OrganizationRole.OWNER),
      ],
    });

    expect(toOrganizationSummaries(response)).toEqual([
      { id: "org-a", name: "Acme", slug: "acme", role: OrganizationRole.OWNER, suspended: false },
      {
        id: "org-g",
        name: "Globex",
        slug: "globex",
        role: OrganizationRole.MEMBER,
        suspended: true,
      },
    ]);
  });

  it("drops a membership that carries no organization", () => {
    const response = create(ListMyOrganizationsResponseSchema, {
      organizations: [
        create(MyOrganizationSchema, { role: OrganizationRole.ADMIN }),
        membership("org-a", "Acme", OrganizationRole.ADMIN),
      ],
    });

    expect(toOrganizationSummaries(response).map((org) => org.id)).toEqual(["org-a"]);
  });
});
