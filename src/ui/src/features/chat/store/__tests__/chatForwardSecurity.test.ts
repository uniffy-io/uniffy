import { describe, expect, it } from "vitest";
import {
  chatMessagesSlice,
  restrictForwardsFromChannel,
  restrictForwardsFromMessage,
  setMessages,
} from "@/features/chat/store/chatMessagesSlice";
import {
  chatThreadsSlice,
  restrictThreadForwardsFromChannel,
  setThreadMessages,
} from "@/features/chat/store/chatThreadsSlice";
import type { ChatMessage } from "@/features/chat/types";

function forwardedMessage(id = "forward-1"): ChatMessage {
  return {
    id,
    channelId: "target-channel",
    senderId: "forwarder",
    senderType: "USER",
    content: "Context",
    rootId: null,
    replyToId: null,
    isForwarded: true,
    forwardContext: {
      sourceMessageId: "source-message",
      sourceChannelId: "source-channel",
      sourceChannelName: "private-source",
      senderId: "source-sender",
      senderType: "USER",
      senderName: "Alice",
      content: "Protected content",
      createdAt: "2026-08-22T00:00:00.000Z",
      attachments: [],
    },
    editedAt: null,
    isDeleted: false,
    isPinned: false,
    metadata: {},
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("forward snapshot revocation", () => {
  it("scrubs channel messages when source-channel access is removed", () => {
    const reducer = chatMessagesSlice.reducer;
    let state = reducer(undefined, { type: "@@init" });
    state = reducer(
      state,
      setMessages({ channelId: "target-channel", messages: [forwardedMessage()] }),
    );

    state = reducer(state, restrictForwardsFromChannel("source-channel"));

    expect(state.byId["forward-1"].isForwarded).toBe(true);
    expect(state.byId["forward-1"].forwardContext).toBeUndefined();
  });

  it("scrubs channel messages when the source message is deleted", () => {
    const reducer = chatMessagesSlice.reducer;
    let state = reducer(undefined, { type: "@@init" });
    state = reducer(
      state,
      setMessages({ channelId: "target-channel", messages: [forwardedMessage()] }),
    );

    state = reducer(state, restrictForwardsFromMessage("source-message"));

    expect(state.byId["forward-1"].forwardContext).toBeUndefined();
  });

  it("scrubs loaded thread snapshots without removing the forward marker", () => {
    const reducer = chatThreadsSlice.reducer;
    let state = reducer(undefined, { type: "@@init" });
    state = reducer(
      state,
      setThreadMessages({ rootMessageId: "root", messages: [forwardedMessage()] }),
    );

    state = reducer(state, restrictThreadForwardsFromChannel("source-channel"));

    expect(state.threadMessages.root[0].isForwarded).toBe(true);
    expect(state.threadMessages.root[0].forwardContext).toBeUndefined();
  });
});
