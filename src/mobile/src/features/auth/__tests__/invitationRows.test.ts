import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { describe, expect, it } from "vitest";
import { invitationRowState, invitationSubtitle } from "@features/auth/invitationRows";

describe("invitationRowState", () => {
  it("leaves every row free while nothing runs", () => {
    expect(invitationRowState(null, "inv-a")).toEqual({
      accepting: false,
      declining: false,
      disabled: false,
    });
  });

  it("marks the running action on its own row and holds every row", () => {
    const pending = { invitationId: "inv-a", action: "accept" } as const;

    expect(invitationRowState(pending, "inv-a")).toEqual({
      accepting: true,
      declining: false,
      disabled: true,
    });
    expect(invitationRowState(pending, "inv-b")).toEqual({
      accepting: false,
      declining: false,
      disabled: true,
    });
  });

  it("tells a decline apart from an accept", () => {
    const pending = { invitationId: "inv-a", action: "decline" } as const;

    expect(invitationRowState(pending, "inv-a")).toEqual({
      accepting: false,
      declining: true,
      disabled: true,
    });
  });
});

describe("invitationSubtitle", () => {
  it("names the role and the inviter", () => {
    expect(
      invitationSubtitle({ role: OrganizationRole.ADMIN, inviterDisplayName: "Grace Hopper" }),
    ).toBe("Invited as Admin by Grace Hopper");
  });

  it("leaves the inviter out when there is none", () => {
    expect(invitationSubtitle({ role: OrganizationRole.MEMBER, inviterDisplayName: null })).toBe(
      "Invited as Member",
    );
  });
});
