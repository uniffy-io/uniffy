import { createSlice, createSelector, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatMessage } from '@/features/chat/types';
import type { RootState } from '@/app/store';

interface TypingEntry {
  userId: string;
  displayName: string;
  expiresAt: number;
  isAgent?: boolean;
}

interface ChatMessagesState {
  byId: Record<string, ChatMessage>;
  idsByChannel: Record<string, string[]>;
  idSetByChannel: Record<string, Record<string, true>>;
  pinnedCountByChannel: Record<string, number>;
  hasMoreByChannel: Record<string, boolean>;
  unreadSeparatorByChannel: Record<string, string | null>;
  isLoadingByChannel: Record<string, boolean>;
  typingByChannel: Record<string, TypingEntry[]>;
  typingByThread: Record<string, TypingEntry[]>;
}

const initialState: ChatMessagesState = {
  byId: {},
  idsByChannel: {},
  idSetByChannel: {},
  pinnedCountByChannel: {},
  hasMoreByChannel: {},
  unreadSeparatorByChannel: {},
  isLoadingByChannel: {},
  typingByChannel: {},
  typingByThread: {},
};

function isPinnedActive(msg: ChatMessage | undefined): boolean {
  return !!msg && !!msg.isPinned && !msg.isDeleted;
}

export const chatMessagesSlice = createSlice({
  name: 'chatMessages',
  initialState,
  reducers: {
    setMessages: (
      state,
      action: PayloadAction<{ channelId: string; messages: ChatMessage[] }>,
    ) => {
      const { channelId, messages } = action.payload;
      const ids: string[] = [];
      const set: Record<string, true> = {};
      let pinned = 0;
      for (const m of messages) {
        if (set[m.id]) continue;
        set[m.id] = true;
        ids.push(m.id);
        state.byId[m.id] = m;
        if (isPinnedActive(m)) pinned += 1;
      }
      state.idsByChannel[channelId] = ids;
      state.idSetByChannel[channelId] = set;
      state.pinnedCountByChannel[channelId] = pinned;
    },
    appendMessage: (
      state,
      action: PayloadAction<{ channelId: string; message: ChatMessage }>,
    ) => {
      const { channelId, message } = action.payload;
      if (!state.idsByChannel[channelId]) state.idsByChannel[channelId] = [];
      if (!state.idSetByChannel[channelId]) state.idSetByChannel[channelId] = {};
      const set = state.idSetByChannel[channelId];
      if (set[message.id]) return;
      set[message.id] = true;
      state.idsByChannel[channelId].push(message.id);
      state.byId[message.id] = message;
      if (isPinnedActive(message)) {
        state.pinnedCountByChannel[channelId] = (state.pinnedCountByChannel[channelId] ?? 0) + 1;
      }
    },
    prependMessages: (
      state,
      action: PayloadAction<{ channelId: string; messages: ChatMessage[] }>,
    ) => {
      const { channelId, messages } = action.payload;
      if (!state.idsByChannel[channelId]) state.idsByChannel[channelId] = [];
      if (!state.idSetByChannel[channelId]) state.idSetByChannel[channelId] = {};
      const set = state.idSetByChannel[channelId];
      const newIds: string[] = [];
      let pinnedDelta = 0;
      for (const m of messages) {
        if (set[m.id]) continue;
        set[m.id] = true;
        newIds.push(m.id);
        state.byId[m.id] = m;
        if (isPinnedActive(m)) pinnedDelta += 1;
      }
      state.idsByChannel[channelId] = [...newIds, ...state.idsByChannel[channelId]];
      if (pinnedDelta) {
        state.pinnedCountByChannel[channelId] = (state.pinnedCountByChannel[channelId] ?? 0) + pinnedDelta;
      }
    },
    updateMessage: (
      state,
      action: PayloadAction<{ channelId: string; message: Partial<ChatMessage> & { id: string } }>,
    ) => {
      const { channelId, message } = action.payload;
      const existing = state.byId[message.id];
      if (!existing) return;
      const wasPinned = isPinnedActive(existing);
      const merged = { ...existing };
      for (const [key, value] of Object.entries(message)) {
        if (value !== undefined) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      state.byId[message.id] = merged;
      const isPinnedNow = isPinnedActive(merged);
      if (wasPinned !== isPinnedNow) {
        const delta = isPinnedNow ? 1 : -1;
        state.pinnedCountByChannel[channelId] = Math.max(
          0,
          (state.pinnedCountByChannel[channelId] ?? 0) + delta,
        );
      }
    },
    deleteMessage: (
      state,
      action: PayloadAction<{ channelId: string; messageId: string }>,
    ) => {
      const { channelId, messageId } = action.payload;
      const existing = state.byId[messageId];
      if (!existing) return;
      const wasPinned = isPinnedActive(existing);
      state.byId[messageId] = { ...existing, isDeleted: true };
      if (wasPinned) {
        state.pinnedCountByChannel[channelId] = Math.max(
          0,
          (state.pinnedCountByChannel[channelId] ?? 0) - 1,
        );
      }
    },
    removeMessage: (
      state,
      action: PayloadAction<{ channelId: string; messageId: string }>,
    ) => {
      const { channelId, messageId } = action.payload;
      const existing = state.byId[messageId];
      const wasPinned = isPinnedActive(existing);
      delete state.byId[messageId];
      const set = state.idSetByChannel[channelId];
      if (set) delete set[messageId];
      const ids = state.idsByChannel[channelId];
      if (ids) {
        state.idsByChannel[channelId] = ids.filter((id) => id !== messageId);
      }
      if (wasPinned) {
        state.pinnedCountByChannel[channelId] = Math.max(
          0,
          (state.pinnedCountByChannel[channelId] ?? 0) - 1,
        );
      }
    },
    evictOldestMessages: (
      state,
      action: PayloadAction<{ channelId: string; count: number }>,
    ) => {
      const { channelId, count } = action.payload;
      const ids = state.idsByChannel[channelId];
      if (!ids || ids.length === 0 || count <= 0) return;
      const drop = Math.min(count, ids.length);
      const evicted = ids.slice(0, drop);
      state.idsByChannel[channelId] = ids.slice(drop);
      const set = state.idSetByChannel[channelId];
      let pinnedDelta = 0;
      for (const id of evicted) {
        if (isPinnedActive(state.byId[id])) pinnedDelta += 1;
        delete state.byId[id];
        if (set) delete set[id];
      }
      if (pinnedDelta) {
        state.pinnedCountByChannel[channelId] = Math.max(
          0,
          (state.pinnedCountByChannel[channelId] ?? 0) - pinnedDelta,
        );
      }
      state.hasMoreByChannel[channelId] = true;
    },
    setHasMore: (
      state,
      action: PayloadAction<{ channelId: string; hasMore: boolean }>,
    ) => {
      state.hasMoreByChannel[action.payload.channelId] = action.payload.hasMore;
    },
    setUnreadSeparator: (
      state,
      action: PayloadAction<{ channelId: string; messageId: string | null }>,
    ) => {
      state.unreadSeparatorByChannel[action.payload.channelId] = action.payload.messageId;
    },
    clearUnreadSeparator: (state, action: PayloadAction<string>) => {
      state.unreadSeparatorByChannel[action.payload] = null;
    },
    setChannelLoading: (
      state,
      action: PayloadAction<{ channelId: string; isLoading: boolean }>,
    ) => {
      state.isLoadingByChannel[action.payload.channelId] = action.payload.isLoading;
    },
    clearChannelMessages: (state, action: PayloadAction<string>) => {
      const channelId = action.payload;
      const ids = state.idsByChannel[channelId];
      if (ids) {
        for (const id of ids) {
          delete state.byId[id];
        }
      }
      delete state.idsByChannel[channelId];
      delete state.idSetByChannel[channelId];
      delete state.pinnedCountByChannel[channelId];
      delete state.hasMoreByChannel[channelId];
      delete state.unreadSeparatorByChannel[channelId];
      delete state.isLoadingByChannel[channelId];
      delete state.typingByChannel[channelId];
    },
    setTypingUser: (
      state,
      action: PayloadAction<{ channelId: string; userId: string; displayName: string }>,
    ) => {
      const { channelId, userId, displayName } = action.payload;
      const TYPING_TTL = 5000;
      const now = Date.now();
      const existing = state.typingByChannel[channelId] ?? [];
      const filtered = existing.filter(e => e.expiresAt > now && e.userId !== userId);
      filtered.push({ userId, displayName, expiresAt: now + TYPING_TTL });
      state.typingByChannel[channelId] = filtered;
    },
    clearTypingUser: (
      state,
      action: PayloadAction<{ channelId: string; userId: string }>,
    ) => {
      const { channelId, userId } = action.payload;
      const existing = state.typingByChannel[channelId];
      if (existing) {
        state.typingByChannel[channelId] = existing.filter(e => e.userId !== userId);
      }
    },
    setAgentTyping: (
      state,
      action: PayloadAction<{
        channelId: string;
        agentId: string;
        displayName: string;
        rootId?: string;
      }>,
    ) => {
      const { channelId, agentId, displayName, rootId } = action.payload;
      const TYPING_TTL = 15000;
      const now = Date.now();
      const entry: TypingEntry = {
        userId: agentId,
        displayName,
        expiresAt: now + TYPING_TTL,
        isAgent: true,
      };
      if (rootId) {
        const existing = state.typingByThread[rootId] ?? [];
        const filtered = existing.filter(e => e.expiresAt > now && e.userId !== agentId);
        filtered.push(entry);
        state.typingByThread[rootId] = filtered;
      } else {
        const existing = state.typingByChannel[channelId] ?? [];
        const filtered = existing.filter(e => e.expiresAt > now && e.userId !== agentId);
        filtered.push(entry);
        state.typingByChannel[channelId] = filtered;
      }
    },
    clearAgentTyping: (
      state,
      action: PayloadAction<{ channelId: string; agentId: string; rootId?: string }>,
    ) => {
      const { channelId, agentId, rootId } = action.payload;
      if (rootId) {
        const existing = state.typingByThread[rootId];
        if (existing) {
          state.typingByThread[rootId] = existing.filter(e => e.userId !== agentId);
        }
      } else {
        const existing = state.typingByChannel[channelId];
        if (existing) {
          state.typingByChannel[channelId] = existing.filter(e => e.userId !== agentId);
        }
      }
    },
    evictExpiredTyping: (
      state,
      action: PayloadAction<{ channelId?: string; rootId?: string } | undefined>,
    ) => {
      const now = Date.now();
      const prune = (entries: TypingEntry[] | undefined): TypingEntry[] | undefined => {
        if (!entries || entries.length === 0) return entries;
        const kept = entries.filter(e => e.expiresAt > now);
        return kept.length === entries.length ? entries : kept;
      };
      const targetChannel = action.payload?.channelId;
      const targetThread = action.payload?.rootId;
      if (targetChannel) {
        const next = prune(state.typingByChannel[targetChannel]);
        if (next !== state.typingByChannel[targetChannel]) {
          state.typingByChannel[targetChannel] = next ?? [];
        }
      }
      if (targetThread) {
        const next = prune(state.typingByThread[targetThread]);
        if (next !== state.typingByThread[targetThread]) {
          state.typingByThread[targetThread] = next ?? [];
        }
      }
      if (!targetChannel && !targetThread) {
        for (const key of Object.keys(state.typingByChannel)) {
          const next = prune(state.typingByChannel[key]);
          if (next !== state.typingByChannel[key]) {
            state.typingByChannel[key] = next ?? [];
          }
        }
        for (const key of Object.keys(state.typingByThread)) {
          const next = prune(state.typingByThread[key]);
          if (next !== state.typingByThread[key]) {
            state.typingByThread[key] = next ?? [];
          }
        }
      }
    },
    addReactionToMessage: (
      state,
      action: PayloadAction<{
        channelId: string;
        messageId: string;
        emoji: string;
        userId: string;
        currentUserId: string;
      }>,
    ) => {
      const { messageId, emoji, userId, currentUserId } = action.payload;
      const msg = state.byId[messageId];
      if (!msg) return;
      if (!msg.reactions) msg.reactions = [];
      const group = msg.reactions.find(r => r.emoji === emoji);
      if (group) {
        if (!group.userIds.includes(userId)) {
          group.count += 1;
          group.userIds.push(userId);
        }
        if (userId === currentUserId) group.currentUserReacted = true;
      } else {
        msg.reactions.push({
          emoji,
          count: 1,
          userIds: [userId],
          currentUserReacted: userId === currentUserId,
        });
      }
    },
    removeReactionFromMessage: (
      state,
      action: PayloadAction<{
        channelId: string;
        messageId: string;
        emoji: string;
        userId: string;
        currentUserId: string;
      }>,
    ) => {
      const { messageId, emoji, userId, currentUserId } = action.payload;
      const msg = state.byId[messageId];
      if (!msg?.reactions) return;
      const group = msg.reactions.find(r => r.emoji === emoji);
      if (!group) return;
      group.count = Math.max(0, group.count - 1);
      group.userIds = group.userIds.filter(id => id !== userId);
      if (userId === currentUserId) group.currentUserReacted = false;
      if (group.count === 0) {
        msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
      }
    },
    appendDelta: (
      state,
      action: PayloadAction<{
        channelId: string;
        messageId: string;
        delta: string;
        sequence: number;
        final: boolean;
      }>,
    ) => {
      const { messageId, delta, sequence, final } = action.payload;
      const msg = state.byId[messageId];
      if (!msg) return;

      const meta = (msg.metadata ?? {}) as Record<string, unknown>;
      const lastSeq = typeof meta.streaming_sequence === 'number' ? meta.streaming_sequence : 0;
      if (sequence <= lastSeq && !final) return;

      msg.content = (msg.content ?? '') + delta;
      const nextMeta: Record<string, unknown> = {
        ...meta,
        streaming_sequence: sequence,
      };
      if (final) {
        delete nextMeta.streaming;
      } else {
        nextMeta.streaming = true;
      }
      msg.metadata = nextMeta;
    },
    clearChatMessages: () => initialState,
  },
});

export const {
  setMessages,
  appendMessage,
  prependMessages,
  updateMessage,
  deleteMessage,
  removeMessage,
  evictOldestMessages,
  setHasMore,
  setUnreadSeparator,
  clearUnreadSeparator,
  setChannelLoading,
  clearChannelMessages,
  setTypingUser,
  clearTypingUser,
  setAgentTyping,
  clearAgentTyping,
  evictExpiredTyping,
  addReactionToMessage,
  removeReactionFromMessage,
  appendDelta,
  clearChatMessages,
} = chatMessagesSlice.actions;

const EMPTY_IDS: readonly string[] = Object.freeze([]);
const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);

export const selectMessageIdsForChannel = (
  state: RootState,
  channelId: string,
): readonly string[] => state.chatMessages.idsByChannel[channelId] ?? EMPTY_IDS;

const messagesSelectorByChannel = new Map<
  string,
  (state: RootState) => ChatMessage[]
>();

export const selectMessagesForChannel = (
  state: RootState,
  channelId: string,
): ChatMessage[] => {
  let selector = messagesSelectorByChannel.get(channelId);
  if (!selector) {
    selector = createSelector(
      [
        (s: RootState) => s.chatMessages.idsByChannel[channelId],
        (s: RootState) => s.chatMessages.byId,
      ],
      (ids, byId): ChatMessage[] => {
        if (!ids || ids.length === 0) return EMPTY_MESSAGES as ChatMessage[];
        const out: ChatMessage[] = [];
        for (const id of ids) {
          const m = byId[id];
          if (m) out.push(m);
        }
        return out;
      },
    );
    messagesSelectorByChannel.set(channelId, selector);
  }
  return selector(state);
};

export const selectMessageById = (
  state: RootState,
  messageId: string,
): ChatMessage | undefined => state.chatMessages.byId[messageId];

export const selectHasMoreForChannel = (
  state: RootState,
  channelId: string,
): boolean => state.chatMessages.hasMoreByChannel[channelId] ?? false;

export const selectUnreadSeparatorForChannel = (
  state: RootState,
  channelId: string,
): string | null => state.chatMessages.unreadSeparatorByChannel[channelId] ?? null;

export const selectIsChannelLoading = (
  state: RootState,
  channelId: string,
): boolean => state.chatMessages.isLoadingByChannel[channelId] ?? false;

export const selectPinnedCountForChannel = (
  state: RootState,
  channelId: string,
): number => state.chatMessages.pinnedCountByChannel[channelId] ?? 0;

type TypingUser = { userId: string; displayName: string; isAgent?: boolean };

const EMPTY_TYPING: readonly TypingUser[] = Object.freeze([]);

const stripExpiry = (entries: TypingEntry[]): TypingUser[] => {
  const now = Date.now();
  const out: TypingUser[] = [];
  for (const e of entries) {
    if (e.expiresAt > now) {
      out.push({ userId: e.userId, displayName: e.displayName, isAgent: e.isAgent });
    }
  }
  return out;
};

const typingChannelSelectorByKey = new Map<string, (state: RootState) => TypingUser[]>();
const typingThreadSelectorByKey = new Map<string, (state: RootState) => TypingUser[]>();

export const selectTypingUsers = (
  state: RootState,
  channelId: string,
): TypingUser[] => {
  let selector = typingChannelSelectorByKey.get(channelId);
  if (!selector) {
    selector = createSelector(
      [(s: RootState) => s.chatMessages.typingByChannel[channelId]],
      (entries): TypingUser[] => (entries ? stripExpiry(entries) : (EMPTY_TYPING as TypingUser[])),
    );
    typingChannelSelectorByKey.set(channelId, selector);
  }
  return selector(state);
};

export const selectTypingInThread = (
  state: RootState,
  rootId: string,
): TypingUser[] => {
  let selector = typingThreadSelectorByKey.get(rootId);
  if (!selector) {
    selector = createSelector(
      [(s: RootState) => s.chatMessages.typingByThread[rootId]],
      (entries): TypingUser[] => (entries ? stripExpiry(entries) : (EMPTY_TYPING as TypingUser[])),
    );
    typingThreadSelectorByKey.set(rootId, selector);
  }
  return selector(state);
};

export const chatMessagesReducer = chatMessagesSlice.reducer;
