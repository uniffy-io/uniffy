import { describe, it, expect } from "vitest";
import {
  getChannelDisplayName,
  getDmDisplayName,
  getDmPeerUserId,
  selfConversationLabel,
} from "@/features/chat/utils/channelDisplay";
import type { ChatChannel } from "@/features/chat/types";

function buildChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: "cid",
    organizationId: "oid",
    ownerId: "uid",
    name: "Acme Agent",
    slug: "acme-agent",
    description: "",
    channelType: "DIRECT",
    categoryId: null,
    isArchived: false,
    isDefault: false,
    isDeleted: false,
    icon: null,
    createdAt: "",
    updatedAt: "",
    messageCount: 0,
    rootMessageCount: 0,
    lastMessageAt: null,
    lastRootMessageAt: null,
    memberCount: 2,
    dmMemberIds: [],
    isAgentDm: true,
    isSelfDm: false,
    agentFolderId: null,
    tagIds: [],
    ...overrides,
  };
}

describe("getChannelDisplayName", () => {
  it("returns the auto-generated name when no custom name is set", () => {
    expect(getChannelDisplayName(buildChannel())).toBe("Acme Agent");
  });

  it("prefers the custom name when set", () => {
    expect(getChannelDisplayName(buildChannel({ customName: "Onboarding plan" }))).toBe(
      "Onboarding plan",
    );
  });

  it("falls back to the auto-generated name on whitespace-only custom names", () => {
    expect(getChannelDisplayName(buildChannel({ customName: "   " }))).toBe("Acme Agent");
  });

  it("trims surrounding whitespace from the custom name", () => {
    expect(getChannelDisplayName(buildChannel({ customName: "  Sprint review  " }))).toBe(
      "Sprint review",
    );
  });
});

describe("self conversation display", () => {
  const selfDm = buildChannel({
    name: "Ada Lovelace",
    ownerId: "me",
    dmMemberIds: ["me"],
    memberCount: 1,
    isAgentDm: false,
    isSelfDm: true,
  });

  it("labels the viewer's own conversation with their live name", () => {
    expect(getDmDisplayName(selfDm, "Ada King")).toBe("Ada King (you)");
  });

  it("falls back to the stored name before the profile has loaded", () => {
    expect(getDmDisplayName(selfDm, "")).toBe("Ada Lovelace (you)");
  });

  it("resolves the viewer as the peer of their own conversation", () => {
    expect(getDmPeerUserId(selfDm, "me")).toBe("me");
  });

  it("never reads a missing peer as the viewer in a 1:1 DM", () => {
    const pair = buildChannel({
      name: "Ada Lovelace, Grace Hopper",
      ownerId: "me",
      dmMemberIds: ["me", "grace"],
      isAgentDm: false,
    });

    expect(getDmDisplayName(pair, "Ada Lovelace")).toBe("Grace Hopper");
    expect(getDmPeerUserId(pair, "me")).toBe("grace");
    expect(getDmPeerUserId({ ...pair, dmMemberIds: ["me"] }, "me")).toBe("");
  });

  it("has no peer for agent and group conversations", () => {
    expect(getDmPeerUserId(buildChannel({ agentId: "agent" }), "me")).toBe("");
    expect(
      getDmPeerUserId(
        buildChannel({ channelType: "GROUP_DM", isAgentDm: false, dmMemberIds: ["me", "x"] }),
        "me",
      ),
    ).toBe("");
  });

  it("uses a neutral label when the name is blank", () => {
    expect(selfConversationLabel("  ")).toBe("You");
  });
});
