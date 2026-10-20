import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { ChatChannelSchema, ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { describe, expect, it, vi } from "vitest";
import { channelToPlain } from "@/features/chat/api/chatConverters";
import { DirectMessageListItem } from "@/features/chat/components/sidebar/DirectMessageListItem";

vi.mock("@/components/subject", () => ({
  SubjectAvatar: () => "group-avatar",
  SubjectAvatarById: ({ userId, showPresence }: { userId: string; showPresence?: boolean }) =>
    `avatar:${userId}:${showPresence ? "presence" : "plain"}`,
}));
vi.mock("@/features/calls/components/ChannelCallIndicator", () => ({
  ChannelCallIndicator: () => null,
}));
vi.mock("@/features/presence/components/CustomStatusDisplay", () => ({
  CustomStatusDisplay: ({ userId }: { userId: string }) => `status:${userId}`,
}));
vi.mock("@/features/chat/hooks/useChannelPrefetch", () => ({
  useChannelPrefetch: () => ({}),
}));
vi.mock("@/features/chat/components/sidebar/ChannelContextMenu", () => ({
  ChannelContextMenu: () => null,
}));
vi.mock("@/features/agents/components/AgentAvatar", () => ({
  AgentAvatar: () => "agent-avatar",
}));

function renderRow(init: Parameters<typeof create<typeof ChatChannelSchema>>[1]) {
  const store = configureStore({
    reducer: {
      auth: () => ({ user: { id: "me", fullName: "Ada Lovelace" } }),
      agents: () => ({ agents: {} }),
    },
  });
  const channel = channelToPlain(
    create(ChatChannelSchema, { id: "dm", channelType: ChannelType.DIRECT, ...init }),
  );
  return renderToStaticMarkup(
    createElement(Provider, {
      store,
      children: createElement(DirectMessageListItem, {
        channel,
        isActive: false,
        onSelect: () => {},
      }),
    }),
  );
}

describe("DirectMessageListItem", () => {
  it("labels the self conversation with the viewer's own name and avatar", () => {
    const html = renderRow({
      name: "Ada Lovelace",
      ownerId: "me",
      dmMemberIds: ["me"],
      isSelfDm: true,
    });

    expect(html).toContain("Ada Lovelace (you)");
    expect(html).toContain('data-dm-kind="self"');
    expect(html).toContain("avatar:me:plain");
    expect(html).not.toContain("status:");
  });

  it("names a 1:1 conversation after the peer with their presence and status", () => {
    const html = renderRow({
      name: "Ada Lovelace, Grace Hopper",
      ownerId: "me",
      dmMemberIds: ["me", "grace"],
    });

    expect(html).toContain("Grace Hopper");
    expect(html).not.toContain("(you)");
    expect(html).toContain('data-dm-kind="user"');
    expect(html).toContain("avatar:grace:presence");
    expect(html).toContain("status:grace");
  });
});
