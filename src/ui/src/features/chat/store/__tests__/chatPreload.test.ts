import { create } from "@bufbuild/protobuf";
import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatChannelSchema, ChatMessageSchema } from "@uniffy/proto/chat/v1/chat_pb";
import type { RootState } from "@/app/store";

const api = vi.hoisted(() => ({
  listChannels: vi.fn(),
  listCategories: vi.fn(),
  listAgentFolders: vi.fn(),
  getMessages: vi.fn(),
  getUnreadCounts: vi.fn(),
  markChannelRead: vi.fn(),
  getChannelPendingApprovals: vi.fn(),
  batchListAttachments: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({ chatApi: api }));
vi.mock("@/features/files/api/attachmentsApi", () => ({ attachmentsApi: api }));

import {
  addChannel,
  chatChannelsSlice,
  updateChannel,
} from "@/features/chat/store/chatChannelsSlice";
import { chatMessagesSlice } from "@/features/chat/store/chatMessagesSlice";
import { chatThreadsSlice } from "@/features/chat/store/chatThreadsSlice";
import {
  fetchMessages,
  initializeChat,
  prefetchChat,
  prefetchChannelMessages,
} from "@/features/chat/store/chatThunks";

function makeStore() {
  const auth = {
    isAuthenticated: true,
    currentOrganizationId: "org-1",
    currentSessionId: "session-1",
    user: { id: "user-1" },
  };
  return configureStore({
    reducer: {
      auth: (state: typeof auth = auth, action) =>
        action.type === "test/switchOrg"
          ? { ...state, currentOrganizationId: "org-2" }
          : action.type === "test/switchSession"
            ? { ...state, currentSessionId: "session-2" }
            : state,
      chatChannels: chatChannelsSlice.reducer,
      chatMessages: chatMessagesSlice.reducer,
      chatThreads: chatThreadsSlice.reducer,
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const channel = create(ChatChannelSchema, {
  id: "channel-1",
  organizationId: "org-1",
  name: "General",
});
const message = create(ChatMessageSchema, {
  id: "message-1",
  channelId: channel.id,
  content: "Unread message",
});
const page = { messages: [message], hasMore: false };

beforeEach(() => {
  vi.resetAllMocks();
  api.listChannels.mockResolvedValue({ channels: [channel] });
  api.listCategories.mockResolvedValue({ categories: [] });
  api.listAgentFolders.mockResolvedValue({ folders: [] });
  api.getMessages.mockResolvedValue(page);
  api.getUnreadCounts.mockResolvedValue({ channels: [] });
  api.batchListAttachments.mockResolvedValue({ groups: [] });
  api.markChannelRead.mockResolvedValue({});
  api.getChannelPendingApprovals.mockResolvedValue({ approvals: [] });
});

afterEach(() => vi.useRealTimers());

describe("chat preloading", () => {
  it("warms a sidebar target without moving the active channel or marking it read", async () => {
    const store = makeStore();
    await initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    await prefetchChannelMessages(channel.id)(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(store.getState().chatChannels.activeChannelId).toBeNull();
    expect(api.markChannelRead).not.toHaveBeenCalled();
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(1);
  });

  it("bounds speculative requests while allowing a clicked channel to load", async () => {
    const store = makeStore();
    await initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    store.dispatch(
      addChannel({ ...store.getState().chatChannels.byId[channel.id], id: "channel-2" }),
    );
    const pending = deferred<typeof page>();
    api.getMessages.mockReturnValueOnce(pending.promise);
    const first = prefetchChannelMessages(channel.id)(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    const second = prefetchChannelMessages("channel-2")(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    await fetchMessages({ channelId: "channel-2" })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
    pending.resolve(page);
    await Promise.all([first, second]);
  });

  it("warms messages without marking them read, then reuses them when opened", async () => {
    const store = makeStore();
    await initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    store.dispatch(
      updateChannel({ ...store.getState().chatChannels.byId[channel.id], unreadCount: 2 }),
    );
    await prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    expect(api.markChannelRead).not.toHaveBeenCalled();
    expect(api.getChannelPendingApprovals).not.toHaveBeenCalled();
    expect(store.getState().chatChannels.byId[channel.id].unreadCount).toBe(2);
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toBeUndefined();

    await initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.listChannels).toHaveBeenCalledTimes(1);
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(api.batchListAttachments).toHaveBeenCalledTimes(1);
    expect(api.markChannelRead).toHaveBeenCalledWith({
      organizationId: "org-1",
      channelId: channel.id,
      lastReadMessageId: message.id,
    });
    expect(store.getState().chatMessages.byId[message.id].content).toBe(message.content);
  });

  it("shares an in-flight preload with a channel opened before it completes", async () => {
    const store = makeStore();
    const pending = deferred<typeof page>();
    api.getMessages.mockReturnValue(pending.promise);
    const warm = prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    await vi.waitFor(() => expect(api.getMessages).toHaveBeenCalledTimes(1));
    const open = fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    pending.resolve(page);
    await Promise.all([warm, open]);
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(api.markChannelRead).toHaveBeenCalledTimes(1);
  });

  it("refreshes a preload after a live channel update", async () => {
    const store = makeStore();
    await prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    store.dispatch(
      updateChannel({ ...store.getState().chatChannels.byId[channel.id], unreadCount: 3 }),
    );
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("expires preloaded history", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    await prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    vi.advanceTimersByTime(30_001);
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("silently drops failed speculation and retries on open", async () => {
    const store = makeStore();
    api.getMessages.mockRejectedValueOnce(new Error("offline"));
    const result = await prefetchChat()(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(result.type).toBe("chat/prefetch/fulfilled");
    expect(store.getState().chatMessages.initialLoadFailedByChannel[channel.id]).toBeUndefined();
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("discards sidebar responses from a workspace that was left during preload", async () => {
    const store = makeStore();
    const pending = deferred<{ channels: (typeof channel)[] }>();
    api.listChannels.mockReturnValue(pending.promise);
    const warm = prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    store.dispatch({ type: "test/switchOrg" });
    pending.resolve({ channels: [channel] });
    await warm;
    expect(store.getState().chatChannels.ids).toEqual([]);
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("shares sidebar requests when Chat opens during initialization", async () => {
    const store = makeStore();
    const pending = deferred<{ channels: (typeof channel)[] }>();
    api.listChannels.mockReturnValue(pending.promise);
    const warm = prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    const open = initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    expect(api.listChannels).toHaveBeenCalledTimes(1);
    expect(api.listCategories).toHaveBeenCalledTimes(1);
    expect(api.listAgentFolders).toHaveBeenCalledTimes(1);
    pending.resolve({ channels: [channel] });
    await Promise.all([warm, open]);
  });

  it("does not fetch history in a workspace with no channels", async () => {
    const store = makeStore();
    api.listChannels.mockResolvedValue({ channels: [] });
    await prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    expect(api.getMessages).not.toHaveBeenCalled();
    expect(store.getState().chatChannels.channelsLoaded).toBe(true);
  });

  it("does not commit an in-flight message response into a subsequent login", async () => {
    const store = makeStore();
    await initializeChat()(store.dispatch, store.getState as () => RootState, undefined);
    const pending = deferred<typeof page>();
    api.getMessages.mockReturnValue(pending.promise);
    const open = fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    store.dispatch({ type: "test/switchSession" });
    pending.resolve(page);
    await open;
    expect(store.getState().chatMessages.idsByChannel[channel.id]).toBeUndefined();
    expect(api.markChannelRead).not.toHaveBeenCalled();
  });

  it("does not reuse another workspace's prefetched history", async () => {
    const store = makeStore();
    await prefetchChat()(store.dispatch, store.getState as () => RootState, undefined);
    store.dispatch({ type: "test/switchOrg" });
    await fetchMessages({ channelId: channel.id })(
      store.dispatch,
      store.getState as () => RootState,
      undefined,
    );
    expect(api.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-2" }),
    );
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });
});
