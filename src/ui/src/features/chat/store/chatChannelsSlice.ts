import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ChatChannel, ChatChannelMember } from '@/features/chat/mock/types';
import type { RootState } from '@/app/store';

interface ChatChannelsState {
  channels: ChatChannel[];
  activeChannelId: string | null;
  splitChannelId: string | null;
  channelMembers: Record<string, ChatChannelMember[]>;
  isLoading: boolean;
}

const initialState: ChatChannelsState = {
  channels: [],
  activeChannelId: null,
  splitChannelId: null,
  channelMembers: {},
  isLoading: false,
};

export const chatChannelsSlice = createSlice({
  name: 'chatChannels',
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<ChatChannel[]>) => {
      state.channels = action.payload;
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
    setChannelMembers: (
      state,
      action: PayloadAction<{ channelId: string; members: ChatChannelMember[] }>,
    ) => {
      state.channelMembers[action.payload.channelId] = action.payload.members;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setSplitChannel: (state, action: PayloadAction<string>) => {
      state.splitChannelId = action.payload;
    },
    clearSplitChannel: (state) => {
      state.splitChannelId = null;
    },
  },
});

export const {
  setChannels,
  setActiveChannel,
  updateChannel,
  setChannelMembers,
  setLoading,
  setSplitChannel,
  clearSplitChannel,
} = chatChannelsSlice.actions;

// -- Selectors --

export const selectChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels;

export const selectActiveChannelId = (state: RootState): string | null =>
  state.chatChannels.activeChannelId;

export const selectActiveChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === state.chatChannels.activeChannelId);

export const selectChannelById = (state: RootState, id: string): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === id);

const sortByLastActivity = (a: ChatChannel, b: ChatChannel): number => {
  const aTime = a.lastActivityAt ?? a.createdAt ?? '';
  const bTime = b.lastActivityAt ?? b.createdAt ?? '';
  return bTime.localeCompare(aTime);
};

export const selectPublicChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter((c) => c.type === 'PUBLIC')
    .sort(sortByLastActivity);

export const selectPrivateChannels = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter((c) => c.type === 'PRIVATE')
    .sort(sortByLastActivity);

export const selectDirectMessages = (state: RootState): ChatChannel[] =>
  state.chatChannels.channels
    .filter((c) => c.type === 'DIRECT' || c.type === 'GROUP_DM')
    .sort(sortByLastActivity);

export const selectChannelMembers = (
  state: RootState,
  channelId: string,
): ChatChannelMember[] => state.chatChannels.channelMembers[channelId] ?? [];

export const selectIsLoading = (state: RootState): boolean =>
  state.chatChannels.isLoading;

export const selectSplitChannelId = (state: RootState): string | null =>
  state.chatChannels.splitChannelId;

export const selectSplitChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.channels.find((c) => c.id === state.chatChannels.splitChannelId);

export const chatChannelsReducer = chatChannelsSlice.reducer;
