import { create } from "@bufbuild/protobuf";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatChannelSchema, ChatMessageSchema } from "@uniffy/proto/chat/v1/chat_pb";
import type { RootState } from "@/app/store";

const api = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getThread: vi.fn(),
  getUnreadCounts: vi.fn(),
  markChannelRead: vi.fn(),
  markChannelUnread: vi.fn(),
  getChannelPendingApprovals: vi.fn(),
  batchListAttachments: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({ chatApi: api }));
vi.mock("@/features/files/api/attachmentsApi", () => ({ attachmentsApi: api }));

import { channelToPlain } from "@/features/chat/api/chatConverters";
import {
  addChannel,
  removeChannel,
  chatChannelsSlice,
  clearChatChannels,
  setActiveChannel,
  updateUnreadCounts,
  setManualUnread,
  clearManualUnread,
  markUnreadCountsLoaded,
} from "@/features/chat/store/chatChannelsSlice";
import {
  chatMessagesSlice,
  clearChatMessages,
  selectMessagesForChannel,
} from "@/features/chat/store/chatMessagesSlice";
import { chatUiSlice } from "@/features/chat/store/chatUiSlice";
import { chatThreadsSlice } from "@/features/chat/store/chatThreadsSlice";
import {
  fetchMessages,
  markChannelUnread,
  fetchUnreadCounts,
  jumpToFirstUnread,
} from "@/features/chat/store/chatThunks";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeStore() {
  const auth = {
    isAuthenticated: true,
    currentOrganizationId: "private-org",
    currentSessionId: "owner-session",
    user: { id: "owner" },
  };
  return configureStore({
    reducer: {
      auth: (state: typeof auth = auth, action) => {
        if (action.type === "test/switchOrg") {
          return { ...state, currentOrganizationId: "unrelated-org" };
        }
        if (action.type === "test/loginAsOtherUser") {
          return {
            ...state,
            currentSessionId: "outsider-session",
            user: { id: "outsider" },
          };
        }
        return state;
      },
      chatChannels: chatChannelsSlice.reducer,
      chatMessages: chatMessagesSlice.reducer,
      chatThreads: chatThreadsSlice.reducer,
      chatUi: chatUiSlice.reducer,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.batchListAttachments.mockResolvedValue({ groups: [] });
  api.markChannelRead.mockResolvedValue({});
  api.getChannelPendingApprovals.mockResolvedValue({ approvals: [] });
});

it.each(["test/switchOrg", "test/loginAsOtherUser"])(
  "discards cleared private messages after %s while unread response is pending",
  async (authChange) => {
    const store = makeStore();
    const channel = create(ChatChannelSchema, {
      id: "private-channel",
      organizationId: "private-org",
      name: "Private channel",
    });
    const message = create(ChatMessageSchema, {
      id: "private-message",
      channelId: channel.id,
      content: "Confidential old-session message",
    });
    store.dispatch(addChannel(channelToPlain(channel)));
    api.getMessages.mockResolvedValue({ messages: [message], hasMore: false });
    const unread = deferred<{ channels: never[] }>();
    api.getUnreadCounts.mockReturnValue(unread.promise);

    const pending = fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    await vi.waitFor(() => expect(api.getUnreadCounts).toHaveBeenCalledTimes(1));
    expect(store.getState().chatMessages.byId[message.id]).toBeUndefined();

    store.dispatch(
      authChange === "test/switchOrg"
        ? { type: "test/switchOrg" }
        : { type: "test/loginAsOtherUser" },
    );
    store.dispatch(clearChatChannels());
    store.dispatch(clearChatMessages());
    expect(store.getState().chatChannels.byId[channel.id]).toBeUndefined();
    expect(store.getState().chatMessages.byId).toEqual({});

    unread.resolve({ channels: [] });
    const result = await pending;
    expect(result.type).toBe("chat/fetchMessages/fulfilled");
    expect(store.getState().chatMessages.byId).toEqual({});
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toBeUndefined();
    expect(selectMessagesForChannel(store.getState() as RootState, channel.id)).toEqual([]);
    expect(store.getState().chatChannels.unreadCountsLoaded).toBe(false);
    expect(api.markChannelRead).not.toHaveBeenCalled();
  },
);

it("restores automatic reading after mark-unread request fails", async () => {
  const store = makeStore();
  const channel = create(ChatChannelSchema, {
    id: "private-channel",
    organizationId: "private-org",
    name: "Private channel",
  });
  store.dispatch(addChannel(channelToPlain(channel)));
  store.dispatch(setActiveChannel(channel.id));
  store.dispatch(updateUnreadCounts([{ channelId: channel.id, unreadCount: 3, mentionCount: 0 }]));
  api.markChannelUnread.mockRejectedValue(new Error("message not found"));

  const result = await markChannelUnread({ channelId: channel.id, messageId: "thread-reply" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );

  expect(result.type).toBe("chat/markChannelUnread/rejected");
  expect(store.getState().chatChannels.manualUnread[channel.id]).toBeUndefined();
  expect(store.getState().chatChannels.manualUnreadRequests).toEqual({});
});

function seedChannel(store: ReturnType<typeof makeStore>) {
  const channel = channelToPlain(
    create(ChatChannelSchema, {
      id: "channel",
      organizationId: "private-org",
      name: "Chat",
    }),
  );
  store.dispatch(addChannel(channel));
  store.dispatch(setActiveChannel(channel.id));
  return channel;
}

it.each(["previous-read", ""])(
  "opens exact unread target outside latest page with cursor %s",
  async (cursor) => {
    const store = makeStore();
    const channel = seedChannel(store);
    const target = create(ChatMessageSchema, { id: "first-unread", channelId: channel.id });
    const tail = create(ChatMessageSchema, { id: "latest", channelId: channel.id });
    api.getUnreadCounts.mockResolvedValue({
      channels: [
        {
          channelId: channel.id,
          unreadCount: 100,
          mentionCount: 0,
          lastReadMessageId: cursor,
          firstUnreadMessageId: target.id,
          latestMessageId: tail.id,
        },
      ],
    });
    api.getMessages.mockImplementation((request) =>
      Promise.resolve({
        messages: request.aroundId ? [target] : [tail],
        hasMore: true,
      }),
    );
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ aroundId: target.id }),
    );
    expect(store.getState().chatMessages.unreadSeparatorByChannel[channel.id]).toBe(target.id);
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toEqual([target.id]);
    expect(store.getState().chatMessages.windowedByChannel[channel.id]).toBe(true);
    expect(store.getState().chatUi.jumpToMessageId).toBe(target.id);
    expect(api.markChannelRead).not.toHaveBeenCalled();
  },
);

it("keeps entry target after automatic read advances mutable cursor", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const target = create(ChatMessageSchema, { id: "first-unread", channelId: channel.id });
  const tail = create(ChatMessageSchema, { id: "latest", channelId: channel.id });
  store.dispatch(markUnreadCountsLoaded());
  store.dispatch(
    updateUnreadCounts([
      {
        channelId: channel.id,
        unreadCount: 2,
        mentionCount: 0,
        firstUnreadMessageId: target.id,
        lastReadMessageId: "previous-read",
      },
    ]),
  );
  api.getMessages.mockResolvedValue({ messages: [target, tail], hasMore: false });
  await fetchMessages({ channelId: channel.id })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  expect(store.getState().chatChannels.byId[channel.id].lastReadMessageId).toBe(tail.id);
  expect(store.getState().chatChannels.byId[channel.id].unreadCount).toBe(0);
  expect(store.getState().chatMessages.unreadSeparatorByChannel[channel.id]).toBe(target.id);
  await jumpToFirstUnread({ channelId: channel.id })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  expect(store.getState().chatUi.jumpToMessageId).toBe(target.id);
});

it("discards unread snapshot after org reset even when channel id is reused", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const unread = deferred<{ channels: object[] }>();
  api.getUnreadCounts.mockReturnValue(unread.promise);
  const pending = fetchUnreadCounts()(store.dispatch, store.getState as () => RootState, undefined);
  store.dispatch({ type: "test/switchOrg" });
  store.dispatch(clearChatChannels());
  store.dispatch(addChannel({ ...channel, organizationId: "unrelated-org" }));
  unread.resolve({ channels: [{ channelId: channel.id, unreadCount: 8, mentionCount: 2 }] });
  await pending;
  expect(store.getState().chatChannels.byId[channel.id].unreadCount).toBeUndefined();
  expect(store.getState().chatChannels.unreadCountsLoaded).toBe(false);
});

it("preserves existing manual unread when a later request fails", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  store.dispatch(setManualUnread(channel.id));
  api.markChannelUnread.mockRejectedValue(new Error("unavailable"));
  await markChannelUnread({ channelId: channel.id, messageId: "target" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  expect(store.getState().chatChannels.manualUnread[channel.id]).toBe(true);
});

it("ignores manual unread response after channel is reopened", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const unread = deferred<object>();
  api.markChannelUnread.mockReturnValue(unread.promise);
  const pending = markChannelUnread({ channelId: channel.id, messageId: "target" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  store.dispatch(clearManualUnread(channel.id));
  unread.resolve({ unreadCount: 4, firstUnreadMessageId: "target" });
  await pending;
  expect(store.getState().chatChannels.manualUnread[channel.id]).toBeUndefined();
  expect(store.getState().chatMessages.unreadSeparatorByChannel[channel.id]).toBeUndefined();
});

it("does not send concurrent manual unread writes for same channel", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const unread = deferred<object>();
  api.markChannelUnread.mockReturnValue(unread.promise);
  const pending = markChannelUnread({ channelId: channel.id, messageId: "target" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  await markChannelUnread({ channelId: channel.id, messageId: "other" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  expect(api.markChannelUnread).toHaveBeenCalledTimes(1);
  unread.resolve({ unreadCount: 4, firstUnreadMessageId: "target" });
  await pending;
});

it("keeps messages available without advancing cursor when unread snapshot fails", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const message = create(ChatMessageSchema, { id: "latest", channelId: channel.id });
  api.getMessages.mockResolvedValue({ messages: [message], hasMore: false });
  api.getUnreadCounts.mockRejectedValue(new Error("snapshot unavailable"));
  await fetchMessages({ channelId: channel.id })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  expect(store.getState().chatMessages.idsByChannel[channel.id]).toEqual([message.id]);
  expect(store.getState().chatChannels.unreadCountsLoaded).toBe(false);
  expect(api.markChannelRead).not.toHaveBeenCalled();
});

it("discards manual unread response after channel removal", async () => {
  const store = makeStore();
  const channel = seedChannel(store);
  const unread = deferred<object>();
  api.markChannelUnread.mockReturnValue(unread.promise);
  const pending = markChannelUnread({ channelId: channel.id, messageId: "target" })(
    store.dispatch,
    store.getState as () => RootState,
    undefined,
  );
  store.dispatch(removeChannel(channel.id));
  unread.resolve({ unreadCount: 4, firstUnreadMessageId: "target" });
  await pending;
  expect(store.getState().chatChannels.manualUnreadRequests).toEqual({});
  expect(store.getState().chatChannels.manualUnread[channel.id]).toBeUndefined();
  expect(store.getState().chatMessages.unreadSeparatorByChannel[channel.id]).toBeUndefined();
});
