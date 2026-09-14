import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ChatMessage, ThreadInboxItem } from "@/features/chat/types";
import type { RootState } from "@/app/store";
import { deleteMessage, updateMessage } from "@/features/chat/store/chatMessagesSlice";
import { REACTOR_PREVIEW_LIMIT } from "@/features/chat/utils/limits";

interface ChatThreadsState {
  activeThreadId: string | null;
  threadMessages: Record<string, ChatMessage[]>;
  followedThreads: string[];
  threadsInbox: ThreadInboxItem[];
  isLoadingThread: boolean;
}

const initialState: ChatThreadsState = {
  activeThreadId: null,
  threadMessages: {},
  followedThreads: [],
  threadsInbox: [],
  isLoadingThread: false,
};

export const chatThreadsSlice = createSlice({
  name: "chatThreads",
  initialState,
  reducers: {
    setActiveThread: (state, action: PayloadAction<string | null>) => {
      state.activeThreadId = action.payload;
    },
    setThreadMessages: (
      state,
      action: PayloadAction<{ rootMessageId: string; messages: ChatMessage[] }>,
    ) => {
      state.threadMessages[action.payload.rootMessageId] = action.payload.messages;
    },
    appendThreadMessage: (
      state,
      action: PayloadAction<{ rootMessageId: string; message: ChatMessage }>,
    ) => {
      const { rootMessageId, message } = action.payload;
      if (!state.threadMessages[rootMessageId]) {
        state.threadMessages[rootMessageId] = [];
      }
      state.threadMessages[rootMessageId].push(message);
    },
    setFollowedThreads: (state, action: PayloadAction<string[]>) => {
      state.followedThreads = action.payload;
    },
    followThread: (state, action: PayloadAction<string>) => {
      if (!state.followedThreads.includes(action.payload)) {
        state.followedThreads.push(action.payload);
      }
    },
    unfollowThread: (state, action: PayloadAction<string>) => {
      state.followedThreads = state.followedThreads.filter((id) => id !== action.payload);
    },
    setThreadsInbox: (state, action: PayloadAction<ThreadInboxItem[]>) => {
      state.threadsInbox = action.payload;
    },
    setLoadingThread: (state, action: PayloadAction<boolean>) => {
      state.isLoadingThread = action.payload;
    },
    clearThreadMessages: (state, action: PayloadAction<string>) => {
      delete state.threadMessages[action.payload];
    },
    restrictThreadForwardsFromChannel: (state, action: PayloadAction<string>) => {
      for (const messages of Object.values(state.threadMessages)) {
        for (const message of messages) {
          if (message.forwardContext?.sourceChannelId === action.payload) {
            message.forwardContext = undefined;
            message.isForwarded = true;
          }
        }
      }
    },
    restrictThreadForwardsFromMessage: (state, action: PayloadAction<string>) => {
      for (const messages of Object.values(state.threadMessages)) {
        for (const message of messages) {
          if (message.forwardContext?.sourceMessageId === action.payload) {
            message.forwardContext = undefined;
            message.isForwarded = true;
          }
        }
      }
    },
    addReactionToThreadMessage: (
      state,
      action: PayloadAction<{
        messageId: string;
        emoji: string;
        userId: string;
        currentUserId: string;
      }>,
    ) => {
      const { messageId, emoji, userId, currentUserId } = action.payload;
      for (const messages of Object.values(state.threadMessages)) {
        const msg = messages.find((m) => m.id === messageId);
        if (!msg) continue;
        if (!msg.reactions) msg.reactions = [];
        const group = msg.reactions.find((r) => r.emoji === emoji);
        if (group) {
          // Mirrors the channel slice: already-counted reactors never count twice,
          // and past the bounded list `currentUserReacted` is the only per-reactor fact.
          const isSelf = userId === currentUserId;
          const counted = isSelf ? group.currentUserReacted : group.userIds.includes(userId);
          if (!counted) {
            group.count += 1;
            if (group.userIds.length < REACTOR_PREVIEW_LIMIT) group.userIds.push(userId);
          }
          if (isSelf) group.currentUserReacted = true;
        } else {
          msg.reactions.push({
            emoji,
            count: 1,
            userIds: [userId],
            currentUserReacted: userId === currentUserId,
          });
        }
        return;
      }
    },
    removeReactionFromThreadMessage: (
      state,
      action: PayloadAction<{
        messageId: string;
        emoji: string;
        userId: string;
        currentUserId: string;
      }>,
    ) => {
      const { messageId, emoji, userId, currentUserId } = action.payload;
      for (const messages of Object.values(state.threadMessages)) {
        const msg = messages.find((m) => m.id === messageId);
        if (!msg?.reactions) continue;
        const group = msg.reactions.find((r) => r.emoji === emoji);
        if (!group) continue;
        const isSelf = userId === currentUserId;
        if (isSelf && !group.currentUserReacted) return;
        group.count = Math.max(0, group.count - 1);
        group.userIds = group.userIds.filter((id) => id !== userId);
        if (isSelf) group.currentUserReacted = false;
        if (group.count === 0) {
          msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
        }
        return;
      }
    },
    appendDeltaToThreadMessage: (
      state,
      action: PayloadAction<{
        messageId: string;
        delta: string;
        sequence: number;
        final: boolean;
      }>,
    ) => {
      const { messageId, delta, sequence, final } = action.payload;
      // The placeholder bucket isn't known; scan all open thread lists.
      for (const messages of Object.values(state.threadMessages)) {
        const msg = messages.find((m) => m.id === messageId);
        if (!msg) continue;

        const meta = (msg.metadata ?? {}) as Record<string, unknown>;
        const lastSeq = typeof meta.streaming_sequence === "number" ? meta.streaming_sequence : 0;
        if (sequence <= lastSeq && !final) return;

        msg.content = (msg.content ?? "") + delta;
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
        return;
      }
    },
    clearChatThreads: () => initialState,
  },
  extraReducers: (builder) => {
    builder.addCase(updateMessage, (state, action) => {
      const { channelId, message } = action.payload;
      for (const messages of Object.values(state.threadMessages)) {
        const existing = messages.find(
          (row) => row.id === message.id && row.channelId === channelId,
        );
        if (!existing) continue;
        for (const [key, value] of Object.entries(message)) {
          if (value !== undefined) {
            (existing as Record<string, unknown>)[key] = value;
          }
        }
      }
    });
    builder.addCase(deleteMessage, (state, action) => {
      const { channelId, messageId } = action.payload;
      for (const messages of Object.values(state.threadMessages)) {
        const existing = messages.find(
          (row) => row.id === messageId && row.channelId === channelId,
        );
        if (existing) existing.isDeleted = true;
      }
    });
  },
});

export const {
  setActiveThread,
  setThreadMessages,
  appendThreadMessage,
  setFollowedThreads,
  followThread,
  unfollowThread,
  setThreadsInbox,
  setLoadingThread,
  clearThreadMessages,
  restrictThreadForwardsFromChannel,
  restrictThreadForwardsFromMessage,
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
  appendDeltaToThreadMessage,
  clearChatThreads,
} = chatThreadsSlice.actions;

export const selectActiveThreadId = (state: RootState): string | null =>
  state.chatThreads.activeThreadId;

export const selectActiveThreadChannelId = (state: RootState): string | null => {
  const activeId = state.chatThreads.activeThreadId;
  if (!activeId) return null;
  return state.chatMessages.byId[activeId]?.channelId ?? null;
};

export const selectActiveThreadMessages = (state: RootState): ChatMessage[] => {
  const activeId = state.chatThreads.activeThreadId;
  if (!activeId) return [];
  return state.chatThreads.threadMessages[activeId] ?? [];
};

export const selectFollowedThreads = (state: RootState): string[] =>
  state.chatThreads.followedThreads;

export const selectThreadsInbox = (state: RootState): ThreadInboxItem[] =>
  state.chatThreads.threadsInbox;

export const selectIsLoadingThread = (state: RootState): boolean =>
  state.chatThreads.isLoadingThread;

export const selectUnreadThreadCount = (state: RootState): number =>
  state.chatThreads.threadsInbox.filter((item) => item.hasUnread).length;

export const chatThreadsReducer = chatThreadsSlice.reducer;
