import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ChatChannelSchema, ChatMessageSchema } from "@uniffy/proto/chat/v1/chat_pb";
import {
  ChatEventType,
  StreamUserChatEventsResponseSchema,
} from "@uniffy/proto/chat/v1/chat_stream_pb";
import {
  chatChannelsReducer,
  setChannels,
  setActiveChannel,
} from "@/features/chat/store/chatChannelsSlice";
import {
  chatMessagesReducer,
  setMessages,
  updateMessage,
} from "@/features/chat/store/chatMessagesSlice";
import {
  chatThreadsReducer,
  setActiveThread,
  setThreadMessages,
} from "@/features/chat/store/chatThreadsSlice";
import { chatDraftsReducer } from "@/features/chat/store/chatDraftsSlice";
import { callsReducer } from "@/features/calls/store/callsSlice";
import { channelToPlain, messageToPlain } from "@/features/chat/api/chatConverters";
import type { AppDispatch, RootState } from "@/app/store";

const api = vi.hoisted(() =>
  Object.fromEntries(
    [
      "listChannels",
      "getChannel",
      "getMessages",
      "getMembers",
      "getUnreadCounts",
      "listDrafts",
      "getThreadsInbox",
      "getThread",
      "getThreadMessages",
      "getPendingAgentApprovals",
    ].map((name) => [name, vi.fn()]),
  ),
);
vi.mock("@/features/chat/api/chatApi", () => ({ chatApi: api }));
vi.mock("@/features/calls/api/callsApi", () => ({
  callsApi: { listActiveCalls: vi.fn().mockResolvedValue({ calls: [] }) },
}));
vi.mock("@/features/files/api/attachmentsApi", () => ({
  attachmentsApi: { batchListAttachments: vi.fn().mockResolvedValue({ groups: [] }) },
}));
import { createChatRecovery } from "@/features/chat/store/chatRecovery";

const channel = create(ChatChannelSchema, { id: "ch", name: "Chat" });
const proto = (id: string, content = id) =>
  create(ChatMessageSchema, { id, channelId: "ch", senderId: "sender", content });
function setup() {
  const store = configureStore({
    reducer: {
      auth: () => ({ user: { id: "user" }, currentOrganizationId: "org", isAuthenticated: true }),
      chatChannels: chatChannelsReducer,
      chatMessages: chatMessagesReducer,
      chatThreads: chatThreadsReducer,
      chatDrafts: chatDraftsReducer,
      calls: callsReducer,
    },
  });
  store.dispatch(setChannels([channelToPlain(channel)]));
  store.dispatch(setActiveChannel("ch"));
  const recovery = createChatRecovery(
    () => store.getState() as RootState,
    store.dispatch as AppDispatch,
  );
  return { store, recovery };
}
const cleanups: (() => void)[] = [];
const drain = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.listChannels.mockResolvedValue({ channels: [channel], nextCursor: "" });
  api.getChannel.mockResolvedValue({ channel });
  api.getMembers.mockResolvedValue({ members: [] });
  api.getMessages.mockResolvedValue({ messages: [proto("root", "updated")], hasMore: false });
  api.getUnreadCounts.mockResolvedValue({
    channels: [{ channelId: "ch", unreadCount: 3, mentionCount: 1 }],
  });
  api.listDrafts.mockResolvedValue({ drafts: [] });
  api.getThreadsInbox.mockResolvedValue({ threads: [] });
  api.getThread.mockResolvedValue({ rootMessage: proto("root") });
  api.getThreadMessages.mockResolvedValue({ messages: [proto("reply")], hasMore: false });
  api.getPendingAgentApprovals.mockResolvedValue({ approvals: [] });
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

describe("complete reconnect snapshots", () => {
  it("replaces cached history, reactions and pins; clears inactive caches", async () => {
    const { store, recovery } = setup();
    cleanups.push(recovery.stop);
    store.dispatch(
      setMessages({
        channelId: "ch",
        messages: [
          messageToPlain(create(ChatMessageSchema, { ...proto("root", "stale"), isPinned: true })),
          messageToPlain(proto("deleted")),
        ],
      }),
    );
    store.dispatch(
      setMessages({
        channelId: "inactive",
        messages: [{ ...messageToPlain(proto("hidden")), channelId: "inactive" }],
      }),
    );
    recovery.recover();
    await drain();
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.getState().chatMessages.byId.root.content).toBe("updated");
    expect(store.getState().chatMessages.byId.root.isPinned).toBe(false);
    expect(store.getState().chatMessages.byId.deleted).toBeUndefined();
    expect(store.getState().chatMessages.byId.hidden).toBeUndefined();
    expect(store.getState().chatChannels.byId.ch.unreadCount).toBe(3);
  });
  it("does not overwrite a live edit with an older in-flight snapshot", async () => {
    const { store, recovery } = setup();
    cleanups.push(recovery.stop);
    store.dispatch(setMessages({ channelId: "ch", messages: [messageToPlain(proto("root"))] }));
    let finish!: (value: unknown) => void;
    api.getMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    recovery.recover();
    await drain();
    recovery.changed(
      create(StreamUserChatEventsResponseSchema, {
        payload: {
          case: "channelEvent",
          value: { channelId: "ch", eventType: ChatEventType.MESSAGE_UPDATED },
        },
      }),
    );
    store.dispatch(updateMessage({ channelId: "ch", message: { id: "root", content: "live" } }));
    finish({ messages: [proto("root", "stale")], hasMore: false });
    await drain();
    expect(store.getState().chatMessages.byId.root.content).toBe("live");
    api.getMessages.mockResolvedValue({ messages: [proto("root", "live")], hasMore: false });
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.getState().chatMessages.byId.root.content).toBe("live");
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });
  it("removes revoked channels and cannot restore them through an older thread snapshot", async () => {
    const { store, recovery } = setup();
    cleanups.push(recovery.stop);
    store.dispatch(setMessages({ channelId: "ch", messages: [messageToPlain(proto("root"))] }));
    store.dispatch(setActiveThread("root"));
    store.dispatch(setThreadMessages({ rootMessageId: "root", messages: [] }));
    let finish!: (value: unknown) => void;
    api.getThreadMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let deny!: (value: unknown) => void;
    api.getChannel.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          deny = reject;
        }),
    );
    recovery.recover();
    await drain();
    deny(new ConnectError("revoked", Code.PermissionDenied));
    await drain();
    finish({ messages: [proto("private")], hasMore: false });
    await drain();
    expect(store.getState().chatChannels.byId.ch).toBeUndefined();
    expect(store.getState().chatMessages.byId.root).toBeUndefined();
    expect(store.getState().chatThreads.threadMessages.root).toBeUndefined();
    expect(store.getState().chatThreads.activeThreadId).toBeNull();
  });
  it("abandoning a connection discards its late history response", async () => {
    const { store, recovery } = setup();
    cleanups.push(recovery.stop);
    let finish!: (value: unknown) => void;
    api.getMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    recovery.recover();
    await drain();
    recovery.stop();
    finish({ messages: [proto("late")], hasMore: false });
    await drain();
    expect(store.getState().chatMessages.byId.late).toBeUndefined();
  });
});

it("refreshes already loaded older pages instead of preserving stale rows", async () => {
  const { store, recovery } = setup();
  cleanups.push(recovery.stop);
  store.dispatch(
    setMessages({
      channelId: "ch",
      messages: Array.from({ length: 180 }, (_, n) => messageToPlain(proto(`m${n}`, "stale"))),
    }),
  );
  api.getMessages.mockImplementation(async (request) =>
    request.beforeId
      ? {
          messages: Array.from({ length: 80 }, (_, n) => proto(`m${n}`, "recovered older")),
          hasMore: false,
        }
      : {
          messages: Array.from({ length: 100 }, (_, n) => proto(`m${n + 80}`, "recovered head")),
          hasMore: true,
        },
  );
  recovery.recover();
  await drain();
  await vi.advanceTimersByTimeAsync(4000);
  const state = store.getState().chatMessages;
  expect(state.idsByChannel.ch).toHaveLength(180);
  expect(state.byId.m0.content).toBe("recovered older");
  expect(state.byId.m179.content).toBe("recovered head");
  expect(state.hasMoreByChannel.ch).toBe(false);
  expect(api.getMessages).toHaveBeenCalledTimes(2);
});

it("keeps an open thread root when bounded channel recovery trims older history", async () => {
  const { store, recovery } = setup();
  cleanups.push(recovery.stop);
  store.dispatch(setMessages({ channelId: "ch", messages: [messageToPlain(proto("root"))] }));
  store.dispatch(setActiveThread("root"));
  api.getMessages.mockResolvedValue({ messages: [proto("new-head")], hasMore: true });
  recovery.recover();
  await drain();
  await vi.advanceTimersByTimeAsync(4000);
  expect(store.getState().chatMessages.byId.root).toBeDefined();
  expect(store.getState().chatThreads.threadMessages.root[0].id).toBe("reply");
});
