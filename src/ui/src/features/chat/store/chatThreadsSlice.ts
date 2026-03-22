import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatMessage, ThreadInboxItem } from '@/features/chat/mock/types';
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
