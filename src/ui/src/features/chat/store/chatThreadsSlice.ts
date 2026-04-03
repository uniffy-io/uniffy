import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatMessage, ThreadInboxItem } from '@/features/chat/types';
import type { RootState } from '@/app/store';

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
  name: 'chatThreads',
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
      state.followedThreads = state.followedThreads.filter(
        (id) => id !== action.payload,
      );
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
        const msg = messages.find(m => m.id === messageId);
        if (!msg) continue;
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
        const msg = messages.find(m => m.id === messageId);
        if (!msg?.reactions) continue;
        const group = msg.reactions.find(r => r.emoji === emoji);
        if (!group) continue;
        group.count = Math.max(0, group.count - 1);
        group.userIds = group.userIds.filter(id => id !== userId);
        if (userId === currentUserId) group.currentUserReacted = false;
        if (group.count === 0) {
          msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
        }
        return;
      }
    },
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
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
} = chatThreadsSlice.actions;

// -- Selectors --

export const selectActiveThreadId = (state: RootState): string | null =>
  state.chatThreads.activeThreadId;

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
