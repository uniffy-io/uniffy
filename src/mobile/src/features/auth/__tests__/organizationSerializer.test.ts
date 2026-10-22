import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { OrganizationInfoSchema, OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import {
  ListMyInvitationsResponseSchema,
  ListMyOrganizationsResponseSchema,
  MyInvitationSchema,
  MyOrganizationSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import { describe, expect, it } from "vitest";
import {
  canCreateOrganization,
  organizationRoleLabel,
  toInvitationSummaries,
  toOrganizationSummaries,
} from "@features/auth/organizationSerializer";

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

describe("canCreateOrganization", () => {
  it("reads the capability the list response carries", () => {
    expect(
      canCreateOrganization(
        create(ListMyOrganizationsResponseSchema, { canCreateOrganization: true }),
      ),
    ).toBe(true);
    expect(canCreateOrganization(create(ListMyOrganizationsResponseSchema, {}))).toBe(false);
  });
});

describe("organizationRoleLabel", () => {
  it("names each role and reads an unknown one as a member", () => {
    expect(organizationRoleLabel(OrganizationRole.OWNER)).toBe("Owner");
    expect(organizationRoleLabel(OrganizationRole.ADMIN)).toBe("Admin");
    expect(organizationRoleLabel(OrganizationRole.MEMBER)).toBe("Member");
    expect(organizationRoleLabel(OrganizationRole.UNSPECIFIED)).toBe("Member");
  });
});

describe("toInvitationSummaries", () => {
  const expiresAt = new Date("2026-11-01T12:00:00Z");

  function invitation(id: string, name: string, inviterDisplayName?: string) {
    return create(MyInvitationSchema, {
      id,
      organization: create(OrganizationInfoSchema, {
        id: `org-${id}`,
        name,
        slug: name.toLowerCase(),
      }),
      role: OrganizationRole.ADMIN,
      inviterDisplayName,
      expiresAt: timestampFromDate(expiresAt),
    });
  }

  it("maps each invitation to its organization, role, inviter and expiry, sorted by name", () => {
    const response = create(ListMyInvitationsResponseSchema, {
      invitations: [invitation("inv-g", "Globex", "Grace Hopper"), invitation("inv-a", "Acme")],
    });

    expect(toInvitationSummaries(response)).toEqual([
      {
        id: "inv-a",
        organizationId: "org-inv-a",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: OrganizationRole.ADMIN,
        inviterDisplayName: null,
        expiresAt,
      },
      {
        id: "inv-g",
        organizationId: "org-inv-g",
        organizationName: "Globex",
        organizationSlug: "globex",
        role: OrganizationRole.ADMIN,
        inviterDisplayName: "Grace Hopper",
        expiresAt,
      },
    ]);
  });

  it("reads a blank inviter name as no inviter", () => {
    const response = create(ListMyInvitationsResponseSchema, {
      invitations: [invitation("inv-a", "Acme", "  ")],
    });

    expect(toInvitationSummaries(response)[0]?.inviterDisplayName).toBeNull();
  });

  it("drops an invitation that carries no organization or no expiry", () => {
    const response = create(ListMyInvitationsResponseSchema, {
      invitations: [
        create(MyInvitationSchema, { id: "inv-x", expiresAt: timestampFromDate(expiresAt) }),
        create(MyInvitationSchema, {
          id: "inv-y",
          organization: create(OrganizationInfoSchema, { id: "org-y", name: "Y", slug: "y" }),
        }),
        invitation("inv-a", "Acme"),
      ],
    });

    expect(toInvitationSummaries(response).map((item) => item.id)).toEqual(["inv-a"]);
  });
});
