import { describe, expect, it } from "vitest";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { resolveMyContentRole } from "@/features/permissions/hooks/useMyContentRole";
import type { ContentAccessPolicy } from "@/features/permissions/store/permissionsSlice";

const ME = "user-me";

function policy(overrides: Partial<ContentAccessPolicy> = {}): ContentAccessPolicy {
  return {
    ownerId: ME,
    accessMode: AccessMode.EXPLICIT_MEMBERS,
    baselineRole: null,
    callerRole: ContentRole.OWNER,
    effectiveAccessMode: null,
    ...overrides,
  };
}

describe("the viewer's role on an item", () => {
  it("takes the role the domain listing carries", () => {
    expect(resolveMyContentRole(ContentRole.EDITOR, policy(), ME)).toBe(ContentRole.EDITOR);
  });

  it("drops a listed OWNER once the item has passed to someone else", () => {
    const transferred = policy({ ownerId: "user-alice", callerRole: ContentRole.ADMIN });

    expect(resolveMyContentRole(ContentRole.OWNER, transferred, ME)).toBe(ContentRole.ADMIN);
  });

  it("keeps a listed OWNER while the policy has not loaded", () => {
    expect(resolveMyContentRole(ContentRole.OWNER, undefined, ME)).toBe(ContentRole.OWNER);
  });

  it("falls back to the server's role when the listing has none", () => {
    const shared = policy({ ownerId: "user-alice", callerRole: ContentRole.VIEWER });

    expect(resolveMyContentRole(ContentRole.UNSPECIFIED, shared, ME)).toBe(ContentRole.VIEWER);
    expect(resolveMyContentRole(null, undefined, ME)).toBeNull();
  });
});
