import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { ChatChannelSchema, ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { describe, expect, it, vi } from "vitest";
import { channelToPlain } from "@/features/chat/api/chatConverters";
import {
  addChannel,
  chatChannelsReducer,
  setActiveChannel,
} from "@/features/chat/store/chatChannelsSlice";
import { chatUiReducer } from "@/features/chat/store/chatUiSlice";
import { ChannelHeader } from "@/features/chat/components/channel/ChannelHeader";

const calls = vi.hoisted(() => ({ availability: 1 }));
vi.mock("@/features/calls/components/callContext", () => ({ useCall: () => calls }));

vi.mock("@/components/subject", () => ({
  SubjectAvatarById: ({ userId }: { userId: string }) => `avatar:${userId}`,
}));
vi.mock("@/features/presence/components/CustomStatusDisplay", () => ({
  CustomStatusDisplay: ({ userId }: { userId: string }) => `status:${userId}`,
}));
vi.mock("@/features/tags", () => ({ TagChip: () => null }));
vi.mock("@/features/tags/store/selectors", () => ({ useTagsByIds: () => [] }));
vi.mock("@/features/chat/components/search/ChatSearchPanel", () => ({
  ChatSearchPanel: () => null,
}));
vi.mock("@/features/chat/components/channel/AgentContextBar", () => ({
  AgentContextBar: () => null,
}));
vi.mock("@/features/chat/components/channel/ChannelAgentsPopover", () => ({
  ChannelAgentsPopover: () => null,
}));
vi.mock("@/features/chat/components/channel/SplitChannelPicker", () => ({
  SplitChannelPicker: () => null,
}));
vi.mock("@/features/chat/components/channel/PinnedMessagesPanel", () => ({
  PinnedMessagesPanel: () => null,
}));
vi.mock("@/features/chat/components/channel/ChannelNextMeeting", () => ({
  ChannelNextMeeting: () => null,
}));
vi.mock("@/features/agents/components/AgentAvatar", () => ({
  AgentAvatar: () => "agent-avatar",
}));

function renderHeader(init: Parameters<typeof create<typeof ChatChannelSchema>>[1]) {
  const store = configureStore({
    reducer: {
      chatChannels: chatChannelsReducer,
      chatUi: chatUiReducer,
      auth: () => ({ user: { id: "me", fullName: "Ada Lovelace" } }),
      agents: () => ({ agents: {} }),
      chatMessages: () => ({ pinnedCountByChannel: {} }),
      calls: () => ({ activeByChannel: {}, session: { status: "idle", channelId: null } }),
    },
  });
  store.dispatch(
    addChannel(
      channelToPlain(
        create(ChatChannelSchema, { id: "dm", channelType: ChannelType.DIRECT, ...init }),
      ),
    ),
  );
  store.dispatch(setActiveChannel("dm"));
  return renderToStaticMarkup(
    createElement(Provider, { store, children: createElement(ChannelHeader) }),
  );
}

describe("ChannelHeader", () => {
  it("shows the viewer's own avatar and name and hides the call and member controls", () => {
    const html = renderHeader({
      name: "Ada Lovelace",
      ownerId: "me",
      dmMemberIds: ["me"],
      memberCount: 1,
      isSelfDm: true,
    });

    expect(html).toContain("Ada Lovelace (you)");
    expect(html).toContain("avatar:me");
    expect(html).not.toContain("status:");
    expect(html).not.toContain('data-testid="chat-channel-call-button"');
    expect(html).not.toContain('data-testid="chat-channel-members-button"');
    expect(html).not.toContain('data-testid="chat-channel-settings-button"');
  });

  it("names a 1:1 conversation after the peer and keeps the call button", () => {
    const html = renderHeader({
      name: "Ada Lovelace, Grace Hopper",
      ownerId: "me",
      dmMemberIds: ["me", "grace"],
      memberCount: 2,
    });

    expect(html).toContain("Grace Hopper");
    expect(html).not.toContain("(you)");
    expect(html).toContain("status:grace");
    expect(html).toContain('data-testid="chat-channel-call-button"');
  });
});

it.each([
  [CallAvailability.DISABLED, "Calls are disabled"],
  [CallAvailability.NOT_CONFIGURED, "Calls are not configured"],
  [CallAvailability.UNREACHABLE, "call service is unavailable"],
])("explains unavailable calls in the header (%s)", (availability, message) => {
  calls.availability = availability;
  try {
    const html = renderHeader({ name: "General", channelType: ChannelType.PUBLIC });
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain(message);
  } finally {
    calls.availability = CallAvailability.READY;
  }
});
