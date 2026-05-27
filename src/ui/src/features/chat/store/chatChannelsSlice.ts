import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatChannel, ChatChannelMember, ChatChannelCategory, ChannelPreferences } from '@/features/chat/types';
import type { RootState } from '@/app/store';

interface ChatChannelsState {
  channels: ChatChannel[];
  activeChannelId: string | null;
  splitChannelId: string | null;
  channelMembers: Record<string, ChatChannelMember[]>;
  channelPreferences: Record<string, ChannelPreferences>;
  categories: ChatChannelCategory[];
  isLoading: boolean;
}

const initialState: ChatChannelsState = {
  channels: [],
  activeChannelId: null,
  splitChannelId: null,
  channelMembers: {},
  channelPreferences: {},
  categories: [],
  isLoading: false,
};

export const chatChannelsSlice = createSlice({
  name: 'chatChannels',
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<ChatChannel[]>) => {
      state.channels = action.payload;
    },
    addChannel: (state, action: PayloadAction<ChatChannel>) => {
      // Idempotent: backend dedups DMs and may return an id we already hold.
      const index = state.channels.findIndex((c) => c.id === action.payload.id);
      if (index >= 0) {
        state.channels[index] = action.payload;
      } else {
        state.channels.push(action.payload);
      }
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      state.channels = state.channels.filter((c) => c.id !== action.payload);
    },
    setActiveChannel: (state, action: PayloadAction<string | null>) => {
      state.activeChannelId = action.payload;
    },
    updateChannel: (state, action: PayloadAction<ChatChannel>) => {
      const index = state.channels.findIndex((c) => c.id === action.payload.id);
      if (index !== -1) {
        state.channels[index] = action.payload;
      }
    },
    updateUnreadCounts: (
      state,
      action: PayloadAction<Array<{ channelId: string; unreadCount: number; mentionCount: number }>>,
    ) => {
      for (const item of action.payload) {
        const channel = state.channels.find((c) => c.id === item.channelId);
        if (channel) {
          channel.unreadCount = item.unreadCount;
          channel.mentionCount = item.mentionCount;
        }
      }
    },
    incrementUnreadCount: (
      state,
      action: PayloadAction<{ channelId: string; mentionCount?: number }>,
    ) => {
      const channel = state.channels.find((c) => c.id === action.payload.channelId);
      if (channel) {
        channel.unreadCount = (channel.unreadCount ?? 0) + 1;
        if (action.payload.mentionCount) {
          channel.mentionCount = (channel.mentionCount ?? 0) + action.payload.mentionCount;
        }
      }
    },
    setChannelMembers: (
      state,
      action: PayloadAction<{ channelId: string; members: ChatChannelMember[] }>,
    ) => {
      state.channelMembers[action.payload.channelId] = action.payload.members;
      const channel = state.channels.find((c) => c.id === action.payload.channelId);
      if (channel) {
        channel.memberCount = action.payload.members.length;
      }
    },
    setCategories: (state, action: PayloadAction<ChatChannelCategory[]>) => {
      state.categories = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setChannelPreferences: (
      state,
      action: PayloadAction<Record<string, ChannelPreferences>>,
    ) => {
      state.channelPreferences = action.payload;
    },
    updateChannelPreference: (
      state,
      action: PayloadAction<{ channelId: string; prefs: Partial<ChannelPreferences> }>,
    ) => {
      const existing = state.channelPreferences[action.payload.channelId];
      if (existing) {
        state.channelPreferences[action.payload.channelId] = {
          ...existing,
          ...action.payload.prefs,
        };
      } else {
        state.channelPreferences[action.payload.channelId] = {
          isMuted: false,
          notificationLevel: 'ALL',
          mutedUntil: null,
          ...action.payload.prefs,
        };
      }
    },
    setSplitChannel: (state, action: PayloadAction<string>) => {
      state.splitChannelId = action.payload;
    },
    clearSplitChannel: (state) => {
      state.splitChannelId = null;
    },
    clearChatChannels: () => initialState,
  },
});

export const {
  setChannels,
  addChannel,
  removeChannel,
  setActiveChannel,
  updateChannel,
  updateUnreadCounts,
  incrementUnreadCount,
  setChannelMembers,
  setChannelPreferences,
  updateChannelPreference,
  setCategories,
  setLoading,
  setSplitChannel,
  clearSplitChannel,
  clearChatChannels,
} = chatChannelsSlice.actions;

export const selectChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels;

export const selectActiveChannelId = (state: RootState): string | null =>
  state.chatChannels.activeChannelId;

export const selectActiveChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === state.chatChannels.activeChannelId);

export const selectChannelById = (state: RootState, id: string): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === id);

const sortByLastActivity = (a: ChatChannel, b: ChatChannel): number => {
  const aTime = a.lastMessageAt ?? a.createdAt ?? '';
  const bTime = b.lastMessageAt ?? b.createdAt ?? '';
  return bTime.localeCompare(aTime);
};

export const selectPublicChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter((c) => c.channelType === 'PUBLIC')
    .sort(sortByLastActivity);

export const selectPrivateChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter((c) => c.channelType === 'PRIVATE')
    .sort(sortByLastActivity);

export const selectDirectMessages = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter(
      (c) =>
        !c.isAgentDm &&
        (c.channelType === 'DIRECT' || c.channelType === 'GROUP_DM'),
    )
    .sort(sortByLastActivity);

export const selectAgentChats = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels.filter((c) => c.isAgentDm).sort(sortByLastActivity);

export const selectChannelMembers = (
  state: RootState,
  channelId: string,
): ChatChannelMember[] => state.chatChannels.channelMembers[channelId] ?? [];

export const selectCategories = (state: RootState): ChatChannelCategory[] =>
  state.chatChannels.categories;

export const selectIsLoading = (state: RootState): boolean =>
  state.chatChannels.isLoading;

export const selectChannelPreferences = (state: RootState): Record<string, ChannelPreferences> =>
  state.chatChannels.channelPreferences;

export const selectSplitChannelId = (state: RootState): string | null =>
  state.chatChannels.splitChannelId;

export const selectSplitChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === state.chatChannels.splitChannelId);

export const chatChannelsReducer = chatChannelsSlice.reducer;
