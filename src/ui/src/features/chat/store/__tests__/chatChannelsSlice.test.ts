import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { ChatChannelSchema, ChatMessageSchema } from "@uniffy/proto/chat/v1/chat_pb";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteChannel: vi.fn(),
  deleteCategory: vi.fn(),
  getChannelPendingApprovals: vi.fn(),
  getMessages: vi.fn(),
  getThread: vi.fn(),
  getChannel: vi.fn(),
  listCategories: vi.fn(),
  listChannels: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: {
    deleteChannel: mocks.deleteChannel,
    deleteCategory: mocks.deleteCategory,
    getChannelPendingApprovals: mocks.getChannelPendingApprovals,
    getMessages: mocks.getMessages,
    getThread: mocks.getThread,
    getChannel: mocks.getChannel,
    listCategories: mocks.listCategories,
    listChannels: mocks.listChannels,
  },
}));

import {
  addChannel,
  chatChannelsSlice,
  removeChannel,
  setActiveChannel,
  setChannels,
  setChannelMembers,
  setChannelPreferences,
  setSplitChannel,
  setManualUnread,
  clearManualUnread,
  updateUnreadCounts,
  archivedLoadStarted,
  setArchivedChannels,
  invalidateArchivedChannels,
  invalidateChannel,
  selectArchivedChannels,
  selectChannels,
} from "@/features/chat/store/chatChannelsSlice";
import {
  chatMessagesSlice,
  selectInitialChannelLoadFailed,
  setMessages,
} from "@/features/chat/store/chatMessagesSlice";
import { chatThreadsSlice } from "@/features/chat/store/chatThreadsSlice";
import {
  deleteCategoryThunk,
  deleteChannel,
  fetchMessages,
  fetchArchivedChannels,
  fetchDraftRoot,
  fetchChannel,
} from "@/features/chat/store/chatThunks";
import type { RootState } from "@/app/store";
import type { ChatChannel, ChatMessage } from "@/features/chat/types";

const reducer = chatChannelsSlice.reducer;

describe("setChannels", () => {
  it("records that an empty channel index finished loading", () => {
    const state = reducer(undefined, setChannels([]));

    expect(state.channelsLoaded).toBe(true);
  });
});

const channel: ChatChannel = {
  id: "channel-1",
  organizationId: "organization-1",
  ownerId: "user-1",
  name: "Delivery",
  slug: "delivery",
  description: "",
  channelType: "PUBLIC",
  categoryId: null,
  isArchived: false,
  isDefault: false,
  isDeleted: false,
  icon: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  messageCount: 0,
  rootMessageCount: 0,
  lastMessageAt: null,
  lastRootMessageAt: null,
  memberCount: 1,
  dmMemberIds: [],
  isAgentDm: false,
  agentFolderId: null,
  tagIds: [],
};

const message: ChatMessage = {
  id: "message-1",
  channelId: channel.id,
  senderId: "user-1",
  senderType: "USER",
  content: "Ready",
  rootId: null,
  replyToId: null,
  isForwarded: false,
  editedAt: null,
  isDeleted: false,
  isPinned: false,
  metadata: {},
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

describe("draft roots", () => {
  const makeStore = () =>
    configureStore({
      reducer: {
        auth: () => ({ currentOrganizationId: "organization-1", user: { id: "user-1" } }),
        chatChannels: reducer,
        chatMessages: chatMessagesSlice.reducer,
      },
    });
  const root = create(ChatMessageSchema, {
    id: "older-root",
    channelId: channel.id,
    content: "Thread root",
  });

  it("loads a zero-reply root without inserting it into the live message window", async () => {
    const store = makeStore();
    store.dispatch(setMessages({ channelId: channel.id, messages: [message] }));
    mocks.getThread.mockResolvedValue({ rootMessage: root });
    await store.dispatch(
      fetchDraftRoot({ channelId: channel.id, rootMessageId: root.id }) as never,
    );
    expect(store.getState().chatMessages.byId[root.id]?.content).toBe(root.content);
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toEqual([message.id]);
    store.dispatch(setMessages({ channelId: channel.id, messages: [message] }));
    expect(store.getState().chatMessages.byId[root.id]?.content).toBe(root.content);
    store.dispatch(chatMessagesSlice.actions.clearChannelMessages(channel.id));
    expect(store.getState().chatMessages.byId[root.id]).toBeUndefined();
  });

  it("does not cache a root fetched before channel removal", async () => {
    const store = makeStore();
    let finish!: (value: { rootMessage: typeof root }) => void;
    mocks.getThread.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = store.dispatch(
      fetchDraftRoot({ channelId: channel.id, rootMessageId: root.id }) as never,
    );
    store.dispatch(removeChannel(channel.id));
    finish({ rootMessage: root });
    await request;
    expect(store.getState().chatMessages.byId[root.id]).toBeUndefined();
  });

  it("rejects unavailable roots", async () => {
    const store = makeStore();
    mocks.getThread.mockResolvedValue({});
    const result = await store.dispatch(
      fetchDraftRoot({ channelId: channel.id, rootMessageId: root.id }) as never,
    );
    expect(fetchDraftRoot.rejected.match(result)).toBe(true);
    expect(store.getState().chatMessages.byId[root.id]).toBeUndefined();
  });
});

describe("archived channels", () => {
  const archived = { ...channel, isArchived: true };
  const makeStore = () =>
    configureStore({
      reducer: {
        auth: () => ({ currentOrganizationId: "organization-1", user: { id: "user-1" } }),
        chatChannels: reducer,
        chatMessages: chatMessagesSlice.reducer,
        chatThreads: chatThreadsSlice.reducer,
      },
    });

  it("keeps archived history addressable without adding it to active lists", () => {
    let state = reducer(undefined, addChannel(archived));
    state = reducer(state, setChannels([{ ...channel, id: "active-channel" }]));
    const root = { chatChannels: state } as RootState;
    expect(state.byId[channel.id]).toEqual(archived);
    expect(selectArchivedChannels(root)).toEqual([archived]);
    expect(selectChannels(root).map((row) => row.id)).toEqual(["active-channel"]);
  });

  it("drops revoked metadata and refuses archive pages fetched before removal", () => {
    let state = reducer(undefined, addChannel(archived));
    state = reducer(state, archivedLoadStarted("pending"));
    state = reducer(state, removeChannel(channel.id));
    state = reducer(
      state,
      setArchivedChannels({
        requestId: "pending",
        channels: [archived],
        nextCursor: null,
        append: false,
      }),
    );
    expect(state.byId[channel.id]).toBeUndefined();
    expect(state.archivedIds).toEqual([]);
  });

  it("refuses single-channel reads fetched before revocation", async () => {
    const store = makeStore();
    let finish!: (value: { channel: ReturnType<typeof create<typeof ChatChannelSchema>> }) => void;
    mocks.getChannel.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = store.dispatch(fetchChannel(channel.id) as never);
    store.dispatch(removeChannel(channel.id));
    finish({ channel: create(ChatChannelSchema, { id: channel.id, isArchived: true }) });
    await request;
    expect(store.getState().chatChannels.byId[channel.id]).toBeUndefined();
  });

  it("does not overwrite a restored channel with an older archived read", async () => {
    const store = makeStore();
    let finish!: (value: { channel: ReturnType<typeof create<typeof ChatChannelSchema>> }) => void;
    mocks.getChannel.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = store.dispatch(fetchChannel(channel.id) as never);
    store.dispatch(invalidateChannel(channel.id));
    store.dispatch(addChannel(channel));
    finish({ channel: create(ChatChannelSchema, { id: channel.id, isArchived: true }) });
    await request;
    expect(store.getState().chatChannels.byId[channel.id].isArchived).toBe(false);
  });

  it("moves restored rows into active lists once", () => {
    let state = reducer(undefined, addChannel(archived));
    state = reducer(state, addChannel(channel));
    state = reducer(state, addChannel(channel));
    expect(state.archivedIds).toEqual([]);
    expect(state.ids).toEqual([channel.id]);
  });

  it("clears archived metadata before reconnect snapshot recovery", () => {
    let state = reducer(undefined, addChannel(archived));
    state = reducer(state, invalidateArchivedChannels({ clear: true }));
    expect(state.archivedIds).toEqual([]);
    expect(state.byId[channel.id]).toBeUndefined();
    expect(state.archivedLoaded).toBe(false);
  });

  it("loads history for an archived channel", async () => {
    const store = makeStore();
    store.dispatch(addChannel(archived));
    mocks.getMessages.mockResolvedValueOnce({ messages: [], hasMore: false });
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );
    expect(mocks.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: channel.id }),
    );
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toEqual([]);
  });

  it("appends subsequent archive pages and retains their cursor", async () => {
    const store = makeStore();
    mocks.listChannels
      .mockResolvedValueOnce({
        channels: [create(ChatChannelSchema, { id: "first", isArchived: true })],
        nextCursor: "older",
      })
      .mockResolvedValueOnce({
        channels: [create(ChatChannelSchema, { id: "second", isArchived: true })],
        nextCursor: "",
      });
    await fetchArchivedChannels()(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );
    expect(store.getState().chatChannels.archivedNextCursor).toBe("older");
    await fetchArchivedChannels({ cursor: "older" })(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );
    expect(mocks.listChannels).toHaveBeenLastCalledWith({
      organizationId: "organization-1",
      archivedOnly: true,
      cursor: "older",
    });
    expect(store.getState().chatChannels.archivedIds).toEqual(["first", "second"]);
    expect(store.getState().chatChannels.archivedNextCursor).toBeNull();
  });

  it("deduplicates concurrent archive loads and leaves failures retryable", async () => {
    const store = makeStore();
    let fail!: (error: Error) => void;
    mocks.listChannels.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const getState = () => store.getState() as unknown as RootState;
    const pending = fetchArchivedChannels()(store.dispatch, getState, undefined);
    await fetchArchivedChannels()(store.dispatch, getState, undefined);
    expect(mocks.listChannels).toHaveBeenCalledTimes(1);
    fail(new Error("Unavailable"));
    await pending;
    expect(store.getState().chatChannels.archivedRequestId).toBeNull();
    expect(store.getState().chatChannels.archivedError).toBe("Unavailable");
    mocks.listChannels.mockResolvedValueOnce({ channels: [], nextCursor: "" });
    await fetchArchivedChannels()(store.dispatch, getState, undefined);
    expect(store.getState().chatChannels.archivedLoaded).toBe(true);
    expect(store.getState().chatChannels.archivedError).toBeNull();
  });
});

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const removeItem = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteChannel.mockResolvedValue({});
  mocks.deleteCategory.mockResolvedValue({});
  mocks.getChannelPendingApprovals.mockResolvedValue({ approvals: [] });
  mocks.listCategories.mockResolvedValue({ categories: [] });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { removeItem },
  });
});

afterAll(() => {
  if (localStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe("removeChannel", () => {
  it("clears active and split references with the channel cache", () => {
    let state = reducer(undefined, { type: "@@init" });
    state = reducer(state, addChannel(channel));
    state = reducer(state, setActiveChannel(channel.id));
    state = reducer(state, setSplitChannel(channel.id));
    state = reducer(
      state,
      setChannelMembers({
        channelId: channel.id,
        members: [
          {
            channelId: channel.id,
            userId: "user-1",
            subjectType: "USER",
            subjectId: "user-1",
            role: "OWNER",
            notificationLevel: "ALL",
            isMuted: false,
            mutedUntil: null,
            followAllThreads: false,
            joinedAt: "2026-08-26T00:00:00.000Z",
          },
        ],
      }),
    );
    state = reducer(
      state,
      setChannelPreferences({
        [channel.id]: {
          isMuted: false,
          notificationLevel: "ALL",
          mutedUntil: null,
        },
      }),
    );

    state = reducer(state, removeChannel(channel.id));

    expect(state.byId[channel.id]).toBeUndefined();
    expect(state.ids).not.toContain(channel.id);
    expect(state.activeChannelId).toBeNull();
    expect(state.splitChannelId).toBeNull();
    expect(state.channelMembers[channel.id]).toBeUndefined();
    expect(state.channelPreferences[channel.id]).toBeUndefined();
  });

  it("clears the active channel, its messages, and its persisted route after deletion", async () => {
    const store = configureStore({
      reducer: {
        auth: () => ({
          currentOrganizationId: "organization-1",
          user: { id: "user-1" },
        }),
        chatChannels: chatChannelsSlice.reducer,
        chatMessages: chatMessagesSlice.reducer,
        chatThreads: chatThreadsSlice.reducer,
      },
    });
    store.dispatch(addChannel(channel));
    store.dispatch(setActiveChannel(channel.id));
    store.dispatch(setMessages({ channelId: channel.id, messages: [message] }));

    await deleteChannel(channel.id)(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );

    expect(mocks.deleteChannel).toHaveBeenCalledWith({
      organizationId: "organization-1",
      channelId: channel.id,
    });
    expect(store.getState().chatChannels.activeChannelId).toBeNull();
    expect(store.getState().chatChannels.byId[channel.id]).toBeUndefined();
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toBeUndefined();
    expect(removeItem).toHaveBeenCalledWith("uniffy-last-channel:organization-1:user-1");

    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it("moves channels out of a deleted category without a reload", async () => {
    const store = configureStore({
      reducer: {
        auth: () => ({
          currentOrganizationId: "organization-1",
          user: { id: "user-1" },
        }),
        chatChannels: chatChannelsSlice.reducer,
      },
    });
    store.dispatch(addChannel({ ...channel, categoryId: "category-1" }));

    await deleteCategoryThunk("category-1")(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );

    expect(mocks.deleteCategory).toHaveBeenCalledWith({
      organizationId: "organization-1",
      categoryId: "category-1",
    });
    expect(store.getState().chatChannels.byId[channel.id]?.categoryId).toBeNull();
  });
});

describe("fetchMessages", () => {
  const makeStore = () =>
    configureStore({
      reducer: {
        auth: () => ({
          currentOrganizationId: "organization-1",
          user: { id: "user-1" },
        }),
        chatChannels: chatChannelsSlice.reducer,
        chatMessages: chatMessagesSlice.reducer,
        chatThreads: chatThreadsSlice.reducer,
      },
    });

  it("recovers an initial message load after a transient failure", async () => {
    const store = makeStore();
    store.dispatch(addChannel(channel));
    mocks.getMessages.mockRejectedValueOnce(new Error("Request timed out"));
    mocks.getMessages.mockResolvedValueOnce({ messages: [], hasMore: false });

    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );

    expect(store.getState().chatMessages.isLoadingByChannel[channel.id]).toBe(false);
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toEqual([]);
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
    expect(
      selectInitialChannelLoadFailed(store.getState() as unknown as RootState, channel.id),
    ).toBe(false);
  });

  it("records a terminal initial-load failure after the retry", async () => {
    const store = makeStore();
    store.dispatch(addChannel(channel));
    mocks.getMessages.mockRejectedValue(new Error("Request timed out"));

    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      () => store.getState() as unknown as RootState,
      undefined,
    );

    expect(store.getState().chatMessages.isLoadingByChannel[channel.id]).toBe(false);
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toBeUndefined();
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
    expect(
      selectInitialChannelLoadFailed(store.getState() as unknown as RootState, channel.id),
    ).toBe(true);
  });
});

describe("manual unread", () => {
  const seeded = () => reducer(undefined, addChannel(channel));

  it("survives re-selecting the channel the user is already standing in", () => {
    let state = reducer(seeded(), setActiveChannel(channel.id));
    state = reducer(state, setManualUnread(channel.id));
    // Leaving the chat route never clears activeChannelId, so selection alone
    // cannot tell a re-render apart from a genuine reopen - only the open does.
    state = reducer(state, setActiveChannel(channel.id));

    expect(state.manualUnread[channel.id]).toBe(true);
  });

  it("clears when the channel is opened", () => {
    let state = reducer(seeded(), setManualUnread(channel.id));
    state = reducer(state, clearManualUnread(channel.id));

    expect(state.manualUnread[channel.id]).toBeUndefined();
  });

  it("leaves other channels' flags alone", () => {
    let state = reducer(seeded(), setManualUnread(channel.id));
    state = reducer(state, setManualUnread("channel-2"));
    state = reducer(state, clearManualUnread(channel.id));

    expect(state.manualUnread[channel.id]).toBeUndefined();
    expect(state.manualUnread["channel-2"]).toBe(true);
  });
});

describe("updateUnreadCounts", () => {
  const seeded = () => reducer(undefined, addChannel(channel));

  it("stores the server read cursor and latest message id", () => {
    const state = reducer(
      seeded(),
      updateUnreadCounts([
        {
          channelId: channel.id,
          unreadCount: 3,
          mentionCount: 1,
          lastReadMessageId: "message-7",
          latestMessageId: "message-10",
        },
      ]),
    );

    expect(state.byId[channel.id].lastReadMessageId).toBe("message-7");
    expect(state.byId[channel.id].latestMessageId).toBe("message-10");
    expect(state.byId[channel.id].unreadCount).toBe(3);
  });

  it("leaves the stored cursor alone when the payload omits it", () => {
    let state = reducer(
      seeded(),
      updateUnreadCounts([
        { channelId: channel.id, unreadCount: 3, mentionCount: 0, lastReadMessageId: "message-7" },
      ]),
    );
    state = reducer(
      state,
      updateUnreadCounts([{ channelId: channel.id, unreadCount: 0, mentionCount: 0 }]),
    );

    expect(state.byId[channel.id].lastReadMessageId).toBe("message-7");
    expect(state.byId[channel.id].unreadCount).toBe(0);
  });
});
