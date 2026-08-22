import { describe, expect, it } from "vitest";
import {
  chatMessagesSlice,
  setMessages,
  setMessageFeedback,
} from "@/features/chat/store/chatMessagesSlice";
import {
  chatThreadsSlice,
  setThreadMessages,
  setThreadMessageFeedback,
} from "@/features/chat/store/chatThreadsSlice";
import type { ChatMessage } from "@/features/chat/types";

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    channelId: "ch-1",
    senderId: "agent-1",
    senderType: "AGENT",
    content: "reply",
    rootId: null,
    replyToId: null,
    editedAt: null,
    isDeleted: false,
    isPinned: false,
    isForwarded: false,
    metadata: {},
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    reactions: [],
    ...overrides,
  };
}

describe("setMessageFeedback", () => {
  const reducer = chatMessagesSlice.reducer;

  function seeded() {
    const initial = reducer(undefined, { type: "@@init" });
    return reducer(initial, setMessages({ channelId: "ch-1", messages: [buildMessage()] }));
  }

  it("stamps the rating on the message", () => {
    const state = reducer(seeded(), setMessageFeedback({ messageId: "m1", rating: "up" }));
    expect(state.byId["m1"].feedbackRating).toBe("up");
  });

  it("replaces an existing rating", () => {
    let state = reducer(seeded(), setMessageFeedback({ messageId: "m1", rating: "up" }));
    state = reducer(state, setMessageFeedback({ messageId: "m1", rating: "down" }));
    expect(state.byId["m1"].feedbackRating).toBe("down");
  });

  it("clears the rating on the empty string", () => {
    let state = reducer(seeded(), setMessageFeedback({ messageId: "m1", rating: "up" }));
    state = reducer(state, setMessageFeedback({ messageId: "m1", rating: "" }));
    expect(state.byId["m1"].feedbackRating).toBeUndefined();
  });

  it("ignores unknown message ids", () => {
    const before = seeded();
    const state = reducer(before, setMessageFeedback({ messageId: "missing", rating: "up" }));
    expect(state.byId).toEqual(before.byId);
  });
});

describe("setThreadMessageFeedback", () => {
  const reducer = chatThreadsSlice.reducer;

  it("stamps and clears the rating on a thread reply", () => {
    const initial = reducer(undefined, { type: "@@init" });
    let state = reducer(
      initial,
      setThreadMessages({
        rootMessageId: "root-1",
        messages: [buildMessage({ id: "m2", rootId: "root-1" })],
      }),
    );
    state = reducer(state, setThreadMessageFeedback({ messageId: "m2", rating: "down" }));
    expect(state.threadMessages["root-1"][0].feedbackRating).toBe("down");
    state = reducer(state, setThreadMessageFeedback({ messageId: "m2", rating: "" }));
    expect(state.threadMessages["root-1"][0].feedbackRating).toBeUndefined();
  });
});
