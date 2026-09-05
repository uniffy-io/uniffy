import { describe, expect, it } from "vitest";
import type { ChatMessage as ProtoChatMessage } from "@uniffy/proto/chat/v1/chat_pb";
import type { MessageInfo } from "@uniffy/proto/agents/v1/sessions_pb";
import { messageToPlain as chatMessageToPlain } from "@/features/chat/api/chatConverters";
import { messageToPlain as sessionMessageToPlain } from "@/features/agents/store/agentMessagesSerde";
import { chatMessagesSlice } from "@/features/chat/store/chatMessagesSlice";
import { chatThreadsSlice } from "@/features/chat/store/chatThreadsSlice";
import * as chatThunks from "@/features/chat/store/chatThunks";
import { sessionsApi } from "@/features/agents/api/sessionsApi";

const RATING_KEY = /rating|feedback/i;

/**
 * Agent replies are plain messages to the client: reactions, copy and reply
 * still apply, but nothing rates them. A rating field that still rides the
 * wire is dropped at the converter so no surface can render or fingerprint it.
 */
describe("agent replies carry no rating", () => {
  it("drops a wire-level rating from chat messages", () => {
    const proto = {
      id: "m1",
      channelId: "ch-1",
      senderId: "agent-1",
      senderType: 2,
      content: "reply",
      metadata: {},
      reactions: [],
      isDeleted: false,
      isPinned: false,
      isForwarded: false,
      feedbackRating: "up",
    } as unknown as ProtoChatMessage;
    const plain = chatMessageToPlain(proto);
    expect(Object.keys(plain).filter((key) => RATING_KEY.test(key))).toEqual([]);
  });

  it("drops a wire-level rating from session messages", () => {
    const proto = {
      id: "m1",
      sessionId: "s1",
      role: 2,
      content: "reply",
      fileIds: [],
      feedbackRating: "down",
    } as unknown as MessageInfo;
    const plain = sessionMessageToPlain(proto);
    expect(Object.keys(plain).filter((key) => RATING_KEY.test(key))).toEqual([]);
  });

  it("exposes no rating reducers, thunks or RPC wrappers", () => {
    const actionNames = [
      ...Object.keys(chatMessagesSlice.actions),
      ...Object.keys(chatThreadsSlice.actions),
    ];
    expect(actionNames.filter((name) => RATING_KEY.test(name))).toEqual([]);
    expect(Object.keys(chatThunks).filter((name) => RATING_KEY.test(name))).toEqual([]);
    expect(Object.keys(sessionsApi).filter((name) => RATING_KEY.test(name))).toEqual([]);
  });

  it("keeps reactions as reactions, not as a stand-in rating", () => {
    expect(chatMessagesSlice.actions).toHaveProperty("addReactionToMessage");
    expect(chatMessagesSlice.actions).toHaveProperty("removeReactionFromMessage");
    expect(chatThreadsSlice.actions).toHaveProperty("addReactionToThreadMessage");
  });
});
