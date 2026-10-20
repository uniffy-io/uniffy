import { create } from "@bufbuild/protobuf";
import { ChannelType, ChatChannelSchema } from "@uniffy/proto/chat/v1/chat_pb";
import { describe, expect, it } from "vitest";
import {
  channelToPlain,
  dmPeerId,
  resolveChannelTitle,
  selfConversationLabel,
  type SerializedMember,
} from "@features/chat/chatSerializer";

function channel(init: Parameters<typeof create<typeof ChatChannelSchema>>[1]) {
  return channelToPlain(
    create(ChatChannelSchema, { id: "dm", channelType: ChannelType.DIRECT, ...init }),
  );
}

const me = { subjectId: "me", displayName: "Ada Lovelace" } as SerializedMember;

describe("self conversation", () => {
  const selfDm = channel({
    name: "Ada Lovelace",
    ownerId: "me",
    dmMemberIds: ["me"],
    memberCount: 1,
    isSelfDm: true,
  });

  it("carries the flag from the proto", () => {
    expect(selfDm.isSelfDm).toBe(true);
    expect(channel({ dmMemberIds: ["me", "grace"] }).isSelfDm).toBe(false);
  });

  it("resolves the viewer as the peer of a single-member DIRECT channel", () => {
    expect(dmPeerId(selfDm, "me")).toBe("me");
  });

  it("titles it with the viewer's name and a (you) marker", () => {
    expect(resolveChannelTitle(selfDm, [me], "me")).toBe("Ada Lovelace (you)");
    expect(resolveChannelTitle(selfDm, undefined, "me")).toBe("Ada Lovelace (you)");
  });

  it("never reads a lone member as the viewer in an ordinary DM", () => {
    const lonely = channel({ name: "Ada Lovelace, Grace Hopper", dmMemberIds: ["me"] });
    expect(dmPeerId(lonely, "me")).toBeNull();
    expect(dmPeerId(channel({ dmMemberIds: ["me", "grace"] }), "me")).toBe("grace");
  });

  it("has no peer in agent or group conversations", () => {
    expect(dmPeerId(channel({ dmMemberIds: ["me", "agent"], isAgentDm: true }), "me")).toBeNull();
    expect(
      dmPeerId(channel({ channelType: ChannelType.GROUP_DM, dmMemberIds: ["me", "a"] }), "me"),
    ).toBeNull();
  });

  it("uses a neutral label when the name is blank", () => {
    expect(selfConversationLabel(" ")).toBe("You");
  });
});
