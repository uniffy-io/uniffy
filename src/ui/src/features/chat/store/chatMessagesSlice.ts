import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatMessage } from '@/features/chat/types';
import type { RootState } from '@/app/store';

interface TypingEntry {
  userId: string;
  displayName: string;
  expiresAt: number;
}

interface ChatMessagesState {
  messagesByChannel: Record<string, ChatMessage[]>;
  hasMoreByChannel: Record<string, boolean>;
  unreadSeparatorByChannel: Record<string, string | null>;
  isLoadingByChannel: Record<string, boolean>;
  typingByChannel: Record<string, TypingEntry[]>;
}

const initialState: ChatMessagesState = {
  messagesByChannel: {},
  hasMoreByChannel: {},
  unreadSeparatorByChannel: {},
  isLoadingByChannel: {},
  typingByChannel: {},
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
      // Deduplicate: skip if message already exists (e.g. local optimistic + stream)
      if (state.messagesByChannel[channelId].some(m => m.id === message.id)) {
        return;
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
      action: PayloadAction<{ channelId: string; message: Partial<ChatMessage> & { id: string } }>,
    ) => {
      const { channelId, message } = action.payload;
      const messages = state.messagesByChannel[channelId];
      if (messages) {
        const index = messages.findIndex((m) => m.id === message.id);
        if (index !== -1) {
          // Merge only defined values to avoid overwriting with undefined
          const existing = messages[index];
          const merged = { ...existing };
          for (const [key, value] of Object.entries(message)) {
            if (value !== undefined) {
              (merged as Record<string, unknown>)[key] = value;
            }
          }
          messages[index] = merged;
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
      delete state.typingByChannel[action.payload];
    },
    setTypingUser: (
      state,
      action: PayloadAction<{ channelId: string; userId: string; displayName: string }>,
    ) => {
      const { channelId, userId, displayName } = action.payload;
      const TYPING_TTL = 5000;
      const now = Date.now();
      const existing = state.typingByChannel[channelId] ?? [];
      // Remove expired entries and upsert the new one
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
      const { channelId, messageId, emoji, userId, currentUserId } = action.payload;
      const messages = state.messagesByChannel[channelId];
      if (!messages) return;
      const msg = messages.find(m => m.id === messageId);
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
      const { channelId, messageId, emoji, userId, currentUserId } = action.payload;
      const messages = state.messagesByChannel[channelId];
      if (!messages) return;
      const msg = messages.find(m => m.id === messageId);
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
  setTypingUser,
  clearTypingUser,
  addReactionToMessage,
  removeReactionFromMessage,
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

export const selectTypingUsers = (
  state: RootState,
  channelId: string,
): { userId: string; displayName: string }[] => {
  const entries = state.chatMessages.typingByChannel[channelId];
  if (!entries) return [];
  const now = Date.now();
  return entries.filter(e => e.expiresAt > now);
};

export const chatMessagesReducer = chatMessagesSlice.reducer;
