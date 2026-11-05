import { describe, expect, it } from "vitest";
import {
  chatMessagesReducer,
  appendMessage,
  setMessages,
} from "@/features/chat/store/chatMessagesSlice";
import {
  chatThreadsReducer,
  appendThreadMessage,
  setThreadMessages,
} from "@/features/chat/store/chatThreadsSlice";
import { pendingMessageId } from "@/features/chat/utils/pendingMessages";
import type { ChatMessage } from "@/features/chat/types";

const pending: ChatMessage = {
  id: pendingMessageId("u", "request"),
  clientMessageId: "request",
  sendStatus: "sending",
  channelId: "channel",
  senderId: "u",
  senderType: "USER",
  content: "Hello",
  rootId: null,
  replyToId: null,
  isForwarded: false,
  editedAt: null,
  isDeleted: false,
  isPinned: false,
  metadata: {},
  createdAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
};
const confirmed: ChatMessage = { ...pending, id: "server", sendStatus: undefined };

describe("pending chat messages", () => {
  it("keeps a stream-confirmed send visible without a second row during retry", () => {
    let state = chatMessagesReducer(
      undefined,
      appendMessage({ channelId: "channel", message: confirmed }),
    );
    state = chatMessagesReducer(state, appendMessage({ channelId: "channel", message: pending }));
    expect(state.idsByChannel.channel).toEqual(["server"]);
    let thread = chatThreadsReducer(
      undefined,
      appendThreadMessage({ rootMessageId: "root", message: confirmed }),
    );
    thread = chatThreadsReducer(
      thread,
      appendThreadMessage({ rootMessageId: "root", message: pending }),
    );
    expect(thread.threadMessages.root.map((m) => m.id)).toEqual(["server"]);
  });
  it("replaces local send when stream arrives before acknowledgement", () => {
    let state = chatMessagesReducer(
      undefined,
      appendMessage({ channelId: "channel", message: pending }),
    );
    state = chatMessagesReducer(state, appendMessage({ channelId: "channel", message: confirmed }));
    state = chatMessagesReducer(state, appendMessage({ channelId: "channel", message: confirmed }));
    expect(state.idsByChannel.channel).toEqual(["server"]);
    expect(state.byId[pending.id]).toBeUndefined();
  });
  it("keeps unacknowledged sends during a history refresh", () => {
    let state = chatMessagesReducer(
      undefined,
      appendMessage({ channelId: "channel", message: pending }),
    );
    state = chatMessagesReducer(state, setMessages({ channelId: "channel", messages: [] }));
    expect(state.idsByChannel.channel).toEqual([pending.id]);
    state = chatMessagesReducer(
      state,
      setMessages({ channelId: "channel", messages: [confirmed] }),
    );
    expect(state.idsByChannel.channel).toEqual(["server"]);
    expect(state.byId[pending.id]).toBeUndefined();
  });
  it("deduplicates stream and acknowledgement in threads", () => {
    let state = chatThreadsReducer(
      undefined,
      appendThreadMessage({ rootMessageId: "root", message: { ...pending, rootId: "root" } }),
    );
    state = chatThreadsReducer(state, setThreadMessages({ rootMessageId: "root", messages: [] }));
    expect(state.threadMessages.root).toHaveLength(1);
    state = chatThreadsReducer(
      state,
      appendThreadMessage({ rootMessageId: "root", message: confirmed }),
    );
    state = chatThreadsReducer(
      state,
      appendThreadMessage({ rootMessageId: "root", message: confirmed }),
    );
    expect(state.threadMessages.root.map((m) => m.id)).toEqual(["server"]);
  });
  it("does not reconcile another sender using the same client identifier", () => {
    let state = chatMessagesReducer(
      undefined,
      appendMessage({ channelId: "channel", message: pending }),
    );
    state = chatMessagesReducer(
      state,
      appendMessage({ channelId: "channel", message: { ...confirmed, senderId: "other" } }),
    );
    expect(state.idsByChannel.channel).toEqual([pending.id, "server"]);
  });
});
