import type { RootState } from "@/app/store";
import type { ChatChannel, ChatMessage } from "@/features/chat/types";

const PRELOAD_TTL_MS = 30_000;

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

interface PreloadState {
  initialization?: { promise: Promise<void>; expiresAt: number };
  unreadCounts?: Promise<void>;
  messages?: {
    channel: ChatChannel;
    promise: Promise<MessagePage>;
    expiresAt: number;
    pending: boolean;
  };
}

// Auth snapshots change on logout, workspace switches, and session refresh. Old
// snapshots cannot supply cached data to the next session and can be collected.
const preloads = new WeakMap<RootState["auth"], PreloadState>();

export function isChatSessionCurrent(
  scope: RootState["auth"],
  current: RootState["auth"],
): boolean {
  return (
    scope.currentOrganizationId === current.currentOrganizationId &&
    scope.currentSessionId === current.currentSessionId &&
    scope.user?.id === current.user?.id &&
    scope.isAuthenticated === current.isAuthenticated
  );
}

function forSession(auth: RootState["auth"]): PreloadState {
  let state = preloads.get(auth);
  if (!state) {
    state = {};
    preloads.set(auth, state);
  }
  return state;
}

export function loadChatInitialization(
  auth: RootState["auth"],
  load: () => Promise<void>,
): Promise<void> {
  const state = forSession(auth);
  if (state.initialization && state.initialization.expiresAt > Date.now()) {
    return state.initialization.promise;
  }
  const entry = { promise: load(), expiresAt: Date.now() + PRELOAD_TTL_MS };
  state.initialization = entry;
  void entry.promise.catch(() => {
    if (state.initialization === entry) state.initialization = undefined;
  });
  return entry.promise;
}

// One org-wide unread snapshot at a time: the channel open and the auxiliary
// hydrate both ask for it on a cold load, and both want the same answer.
export function loadUnreadCounts(
  auth: RootState["auth"],
  load: () => Promise<void>,
): Promise<void> {
  const state = forSession(auth);
  if (state.unreadCounts) return state.unreadCounts;
  const promise = load().finally(() => {
    if (state.unreadCounts === promise) state.unreadCounts = undefined;
  });
  state.unreadCounts = promise;
  return promise;
}

export async function loadLatestChannelMessages(
  getState: () => RootState,
  channelId: string,
  load: () => Promise<MessagePage>,
  preload = false,
): Promise<MessagePage> {
  const snapshot = getState();
  const state = forSession(snapshot.auth);
  const channel = snapshot.chatChannels.byId[channelId];
  let entry = state.messages;
  // Pointer movement must not fill the connection pool with speculative reads.
  if (preload && entry?.pending) return entry.promise;
  if (!entry || entry.channel !== channel || entry.expiresAt <= Date.now()) {
    entry = { channel, promise: load(), expiresAt: Date.now() + PRELOAD_TTL_MS, pending: true };
    state.messages = entry;
  }
  try {
    const page = await entry.promise;
    // A live channel update invalidates a prefetched snapshot, including unread
    // changes and membership changes received while the request was in flight.
    if (
      !preload &&
      isChatSessionCurrent(snapshot.auth, getState().auth) &&
      getState().chatChannels.byId[channelId] !== channel
    ) {
      return await load();
    }
    return page;
  } catch (error) {
    if (state.messages === entry) state.messages = undefined;
    throw error;
  } finally {
    entry.pending = false;
    if (!preload && state.messages === entry) state.messages = undefined;
  }
}
