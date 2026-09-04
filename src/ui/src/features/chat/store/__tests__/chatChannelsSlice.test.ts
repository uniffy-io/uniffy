import { configureStore } from "@reduxjs/toolkit";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteChannel: vi.fn(),
  deleteCategory: vi.fn(),
  getChannelPendingApprovals: vi.fn(),
  getMessages: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: {
    deleteChannel: mocks.deleteChannel,
    deleteCategory: mocks.deleteCategory,
    getChannelPendingApprovals: mocks.getChannelPendingApprovals,
    getMessages: mocks.getMessages,
    listCategories: mocks.listCategories,
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
