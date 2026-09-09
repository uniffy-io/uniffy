import { describe, expect, it } from "vitest";
import { deleteMessage, updateMessage } from "@/features/chat/store/chatMessagesSlice";
import {
  appendDeltaToThreadMessage,
  chatThreadsReducer,
  setThreadMessages,
} from "@/features/chat/store/chatThreadsSlice";
import type { ChatMessage } from "@/features/chat/types";

const reply: ChatMessage = {
  id: "reply",
  channelId: "channel",
  senderId: "agent",
  senderType: "AGENT",
  content: "",
  rootId: "root",
  replyToId: null,
  editedAt: null,
  isDeleted: false,
  isPinned: false,
  metadata: { streaming: true },
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

function loadedThread() {
  return chatThreadsReducer(
    undefined,
    setThreadMessages({ rootMessageId: "root", messages: [reply] }),
  );
}

describe("thread message updates", () => {
  it("replaces a streamed fragment with the complete response and its attribution", () => {
    let state = chatThreadsReducer(
      loadedThread(),
      appendDeltaToThreadMessage({ messageId: "reply", delta: "Hel", sequence: 1, final: false }),
    );
    state = chatThreadsReducer(
      state,
      updateMessage({
        channelId: "channel",
        message: {
          id: "reply",
          content: "Hello from the completed skill.",
          metadata: { skill_invocation_id: "invocation", skill_version_number: "1" },
        },
      }),
    );

    expect(state.threadMessages.root[0]).toMatchObject({
      content: "Hello from the completed skill.",
      metadata: { skill_invocation_id: "invocation", skill_version_number: "1" },
    });
    expect(state.threadMessages.root[0].metadata).not.toHaveProperty("streaming");
  });

  it("applies ordinary edits and deletions while preserving unspecified fields", () => {
    let state = chatThreadsReducer(
      loadedThread(),
      updateMessage({
        channelId: "channel",
        message: { id: "reply", content: "Edited reply", metadata: undefined },
      }),
    );
    expect(state.threadMessages.root[0]).toMatchObject({
      content: "Edited reply",
      metadata: { streaming: true },
      senderId: "agent",
    });

    state = chatThreadsReducer(state, deleteMessage({ channelId: "channel", messageId: "reply" }));
    expect(state.threadMessages.root[0].isDeleted).toBe(true);
  });

  it("ignores updates from another channel and does not insert unrelated messages", () => {
    const initial = loadedThread();
    let state = chatThreadsReducer(
      initial,
      updateMessage({ channelId: "other", message: { id: "reply", content: "Unrelated" } }),
    );
    state = chatThreadsReducer(state, deleteMessage({ channelId: "other", messageId: "reply" }));
    state = chatThreadsReducer(
      state,
      updateMessage({ channelId: "channel", message: { id: "unloaded", content: "Unrelated" } }),
    );
    expect(state).toEqual(initial);
  });
});
