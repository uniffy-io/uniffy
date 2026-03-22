import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatMessage } from '@/features/chat/mock/types';
import type { RootState } from '@/app/store';

interface ChatMessagesState {
  messagesByChannel: Record<string, ChatMessage[]>;
  hasMoreByChannel: Record<string, boolean>;
  unreadSeparatorByChannel: Record<string, string | null>;
  isLoadingByChannel: Record<string, boolean>;
}

const initialState: ChatMessagesState = {
  messagesByChannel: {},
  hasMoreByChannel: {},
  unreadSeparatorByChannel: {},
  isLoadingByChannel: {},
};

export const chatMessagesSlice = createSlice({
  name: 'chatMessages',
  initialState,
  reducers: {
    setMessages: (
      state,
      action: PayloadAction<{ channelId: string; messages: ChatMessage[] }>,
    ) => {
      state.messagesByChannel[action.payload.channelId] = action.payload.messages;
    },
    appendMessage: (
      state,
      action: PayloadAction<{ channelId: string; message: ChatMessage }>,
    ) => {
      const { channelId, message } = action.payload;
      if (!state.messagesByChannel[channelId]) {
        state.messagesByChannel[channelId] = [];
      }
      state.messagesByChannel[channelId].push(message);
    },
    prependMessages: (
      state,
      action: PayloadAction<{ channelId: string; messages: ChatMessage[] }>,
    ) => {
      const { channelId, messages } = action.payload;
      if (!state.messagesByChannel[channelId]) {
        state.messagesByChannel[channelId] = [];
      }
      state.messagesByChannel[channelId] = [
        ...messages,
        ...state.messagesByChannel[channelId],
      ];
    },
    updateMessage: (
      state,
      action: PayloadAction<{ channelId: string; message: ChatMessage }>,
    ) => {
      const { channelId, message } = action.payload;
      const messages = state.messagesByChannel[channelId];
      if (messages) {
        const index = messages.findIndex((m) => m.id === message.id);
        if (index !== -1) {
          messages[index] = message;
        }
      }
    },
    deleteMessage: (
      state,
      action: PayloadAction<{ channelId: string; messageId: string }>,
    ) => {
      const { channelId, messageId } = action.payload;
      const messages = state.messagesByChannel[channelId];
      if (messages) {
        const index = messages.findIndex((m) => m.id === messageId);
        if (index !== -1) {
          messages[index] = { ...messages[index], isDeleted: true };
        }
      }
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
      delete state.messagesByChannel[action.payload];
      delete state.hasMoreByChannel[action.payload];
      delete state.unreadSeparatorByChannel[action.payload];
      delete state.isLoadingByChannel[action.payload];
    },
  },
});

export const {
  setMessages,
  appendMessage,
  prependMessages,
  updateMessage,
  deleteMessage,
  setHasMore,
  setUnreadSeparator,
  clearUnreadSeparator,
  setChannelLoading,
  clearChannelMessages,
} = chatMessagesSlice.actions;

// -- Selectors --

export const selectMessagesForChannel = (
  state: RootState,
  channelId: string,
): ChatMessage[] => state.chatMessages.messagesByChannel[channelId] ?? [];

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

export const chatMessagesReducer = chatMessagesSlice.reducer;
