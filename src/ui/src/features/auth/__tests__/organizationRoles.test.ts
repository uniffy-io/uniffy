import { describe, expect, it } from "vitest";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { listedRoleDiffers } from "@/features/auth/utils/organizationRoles";

const organizations = [
  { id: "org-acme", role: OrganizationRole.OWNER },
  { id: "org-globex", role: OrganizationRole.MEMBER },
];

describe("listedRoleDiffers", () => {
  it("reports a listed role the token does not carry", () => {
    expect(listedRoleDiffers(organizations, "org-acme", "MEMBER")).toBe(true);
    expect(listedRoleDiffers(organizations, "org-globex", "OWNER")).toBe(true);
    expect(listedRoleDiffers(organizations, "org-acme", null)).toBe(true);
  });

  it("stays quiet when the token already carries the listed role", () => {
    expect(listedRoleDiffers(organizations, "org-acme", "OWNER")).toBe(false);
    expect(listedRoleDiffers(organizations, "org-globex", "MEMBER")).toBe(false);
  });

  it("stays quiet without an organization in the tab or in the list", () => {
    expect(listedRoleDiffers(organizations, null, "MEMBER")).toBe(false);
    expect(listedRoleDiffers(organizations, "org-initech", "MEMBER")).toBe(false);
  });

  it("ignores a listed role with no token form", () => {
    const unspecified = [{ id: "org-acme", role: OrganizationRole.UNSPECIFIED }];
    expect(listedRoleDiffers(unspecified, "org-acme", "OWNER")).toBe(false);
  });
});
