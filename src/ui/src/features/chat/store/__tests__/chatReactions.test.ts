import { describe, it, expect } from "vitest";
import {
  chatMessagesReducer,
  addReactionToMessage,
  removeReactionFromMessage,
  setMessages,
} from "@/features/chat/store/chatMessagesSlice";
import { REACTOR_PREVIEW_LIMIT } from "@/features/chat/utils/limits";
import type { ChatMessage } from "@/features/chat/types";

const CHANNEL_ID = "ch-1";
const MESSAGE_ID = "msg-1";
const ME = "me";

function seed(reactions: ChatMessage["reactions"]) {
  const message = {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    senderId: "other",
    senderType: "USER",
    content: "ship it?",
    createdAt: "2026-07-16T00:00:00.000Z",
    rootId: null,
    reactions,
  } as unknown as ChatMessage;
  return chatMessagesReducer(
    undefined,
    setMessages({ channelId: CHANNEL_ID, messages: [message] }),
  );
}

function group(state: ReturnType<typeof seed>) {
  return state.byId[MESSAGE_ID].reactions?.[0];
}

const add = (userId: string) =>
  addReactionToMessage({
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    emoji: "fire",
    userId,
    currentUserId: ME,
  });

const remove = (userId: string) =>
  removeReactionFromMessage({
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    emoji: "fire",
    userId,
    currentUserId: ME,
  });

describe("reaction reducers", () => {
  it("counts a new reactor once and adds them to the list", () => {
    const state = chatMessagesReducer(seed([]), add("u-1"));
    expect(group(state)).toMatchObject({ emoji: "fire", count: 1, userIds: ["u-1"] });
  });

  it("ignores a repeated add for the same reactor", () => {
    let state = chatMessagesReducer(seed([]), add("u-1"));
    state = chatMessagesReducer(state, add("u-1"));
    expect(group(state)?.count).toBe(1);
    expect(group(state)?.userIds).toEqual(["u-1"]);
  });

  it("ignores the echo of my own add even when the list is already full", () => {
    const others = Array.from({ length: REACTOR_PREVIEW_LIMIT }, (_, i) => `u-${i}`);
    let state = seed([
      { emoji: "fire", count: REACTOR_PREVIEW_LIMIT, userIds: others, currentUserReacted: false },
    ]);
    state = chatMessagesReducer(state, add(ME));
    state = chatMessagesReducer(state, add(ME));
    expect(group(state)?.count).toBe(REACTOR_PREVIEW_LIMIT + 1);
    expect(group(state)?.currentUserReacted).toBe(true);
  });

  it("stops growing the reactor list at the server's bound", () => {
    let state = seed([]);
    for (let i = 0; i < REACTOR_PREVIEW_LIMIT + 3; i += 1) {
      state = chatMessagesReducer(state, add(`u-${i}`));
    }
    expect(group(state)?.count).toBe(REACTOR_PREVIEW_LIMIT + 3);
    expect(group(state)?.userIds).toHaveLength(REACTOR_PREVIEW_LIMIT);
  });

  it("decrements my own removal exactly once across the optimistic write and its echo", () => {
    let state = seed([
      { emoji: "fire", count: 12, userIds: [ME, "u-1", "u-2"], currentUserReacted: true },
    ]);
    state = chatMessagesReducer(state, remove(ME));
    state = chatMessagesReducer(state, remove(ME));
    expect(group(state)?.count).toBe(11);
    expect(group(state)?.currentUserReacted).toBe(false);
    expect(group(state)?.userIds).toEqual(["u-1", "u-2"]);
  });

  it("still counts another member's removal from beyond the bounded list", () => {
    let state = seed([
      { emoji: "fire", count: 12, userIds: ["u-1", "u-2"], currentUserReacted: false },
    ]);
    state = chatMessagesReducer(state, remove("far-away-reactor"));
    expect(group(state)?.count).toBe(11);
  });

  it("drops the group when the last reactor leaves", () => {
    let state = seed([{ emoji: "fire", count: 1, userIds: [ME], currentUserReacted: true }]);
    state = chatMessagesReducer(state, remove(ME));
    expect(state.byId[MESSAGE_ID].reactions).toEqual([]);
  });
});
