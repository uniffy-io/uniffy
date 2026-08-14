import { createSlice, createSelector, type PayloadAction } from "@reduxjs/toolkit";
import type {
  ChatChannel,
  ChatChannelMember,
  ChatChannelCategory,
  ChatAgentFolder,
  ChannelPreferences,
} from "@/features/chat/types";
import type { RootState } from "@/app/store";

// Channels are normalized (byId + ids) so per-channel mutations - unread
// bumps, activity touches - invalidate only that channel's subscribers.
// A flat array made every message org-wide re-render every consumer.
interface ChatChannelsState {
  byId: Record<string, ChatChannel>;
  ids: string[];
  activeChannelId: string | null;
  splitChannelId: string | null;
  channelMembers: Record<string, ChatChannelMember[]>;
  channelPreferences: Record<string, ChannelPreferences>;
  categories: ChatChannelCategory[];
  agentFolders: ChatAgentFolder[];
  isLoading: boolean;
}

const initialState: ChatChannelsState = {
  byId: {},
  ids: [],
  activeChannelId: null,
  splitChannelId: null,
  channelMembers: {},
  channelPreferences: {},
  categories: [],
  agentFolders: [],
  isLoading: false,
};

export const chatChannelsSlice = createSlice({
  name: "chatChannels",
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<ChatChannel[]>) => {
      state.byId = {};
      state.ids = [];
      for (const channel of action.payload) {
        state.byId[channel.id] = channel;
        state.ids.push(channel.id);
      }
    },
    addChannel: (state, action: PayloadAction<ChatChannel>) => {
      // Idempotent: backend dedups DMs and may return an id we already hold.
      const existing = state.byId[action.payload.id];
      if (!existing) {
        state.ids.push(action.payload.id);
      }
      // Only ListChannels populates the per-user folder id; a single-channel
      // fetch or stream payload carrying null must not unfile the chat.
      state.byId[action.payload.id] = {
        ...action.payload,
        agentFolderId: action.payload.agentFolderId ?? existing?.agentFolderId ?? null,
      };
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      if (state.byId[action.payload]) {
        delete state.byId[action.payload];
        state.ids = state.ids.filter((id) => id !== action.payload);
      }
    },
    setActiveChannel: (state, action: PayloadAction<string | null>) => {
      state.activeChannelId = action.payload;
    },
    updateChannel: (state, action: PayloadAction<ChatChannel>) => {
      const existing = state.byId[action.payload.id];
      if (existing) {
        state.byId[action.payload.id] = {
          ...action.payload,
          agentFolderId: action.payload.agentFolderId ?? existing.agentFolderId ?? null,
        };
      }
    },
    updateUnreadCounts: (
      state,
      action: PayloadAction<
        Array<{ channelId: string; unreadCount: number; mentionCount: number }>
      >,
    ) => {
      for (const item of action.payload) {
        const channel = state.byId[item.channelId];
        // Skip no-op writes so an already-clear channel keeps its object identity.
        if (
          channel &&
          (channel.unreadCount !== item.unreadCount || channel.mentionCount !== item.mentionCount)
        ) {
          channel.unreadCount = item.unreadCount;
          channel.mentionCount = item.mentionCount;
        }
      }
    },
    incrementUnreadCount: (
      state,
      action: PayloadAction<{ channelId: string; mentionCount?: number }>,
    ) => {
      const channel = state.byId[action.payload.channelId];
      if (channel) {
        channel.unreadCount = (channel.unreadCount ?? 0) + 1;
        if (action.payload.mentionCount) {
          channel.mentionCount = (channel.mentionCount ?? 0) + action.payload.mentionCount;
        }
      }
    },
    touchChannelActivity: (
      state,
      action: PayloadAction<{ channelId: string; at: string; isRoot: boolean }>,
    ) => {
      const channel = state.byId[action.payload.channelId];
      if (!channel) return;
      const { at, isRoot } = action.payload;
      // Stream events can arrive out of order; only move time forward.
      if (!channel.lastMessageAt || at > channel.lastMessageAt) {
        channel.lastMessageAt = at;
      }
      if (isRoot && (!channel.lastRootMessageAt || at > channel.lastRootMessageAt)) {
        channel.lastRootMessageAt = at;
      }
    },
    setChannelMembers: (
      state,
      action: PayloadAction<{ channelId: string; members: ChatChannelMember[] }>,
    ) => {
      state.channelMembers[action.payload.channelId] = action.payload.members;
      const channel = state.byId[action.payload.channelId];
      if (channel && channel.memberCount !== action.payload.members.length) {
        channel.memberCount = action.payload.members.length;
      }
    },
    setMemberRole: (
      state,
      action: PayloadAction<{
        channelId: string;
        userId: string;
        role: ChatChannelMember["role"];
      }>,
    ) => {
      const members = state.channelMembers[action.payload.channelId];
      const member = members?.find(
        (m) => m.subjectType === "USER" && m.userId === action.payload.userId,
      );
      if (member) {
        member.role = action.payload.role;
      }
    },
    setCategories: (state, action: PayloadAction<ChatChannelCategory[]>) => {
      state.categories = action.payload;
    },
    setAgentFolders: (state, action: PayloadAction<ChatAgentFolder[]>) => {
      state.agentFolders = action.payload;
    },
    upsertAgentFolder: (state, action: PayloadAction<ChatAgentFolder>) => {
      const index = state.agentFolders.findIndex((f) => f.id === action.payload.id);
      if (index >= 0) {
        state.agentFolders[index] = action.payload;
      } else {
        state.agentFolders.push(action.payload);
      }
    },
    removeAgentFolder: (state, action: PayloadAction<string>) => {
      state.agentFolders = state.agentFolders.filter((f) => f.id !== action.payload);
      for (const id of state.ids) {
        const channel = state.byId[id];
        if (channel?.agentFolderId === action.payload) {
          channel.agentFolderId = null;
        }
      }
    },
    setChannelAgentFolder: (
      state,
      action: PayloadAction<{ channelId: string; folderId: string | null }>,
    ) => {
      const channel = state.byId[action.payload.channelId];
      if (channel) {
        channel.agentFolderId = action.payload.folderId;
      }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setChannelPreferences: (state, action: PayloadAction<Record<string, ChannelPreferences>>) => {
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
          notificationLevel: "ALL",
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
  touchChannelActivity,
  setChannelMembers,
  setMemberRole,
  setChannelPreferences,
  updateChannelPreference,
  setCategories,
  setAgentFolders,
  upsertAgentFolder,
  removeAgentFolder,
  setChannelAgentFolder,
  setLoading,
  setSplitChannel,
  clearSplitChannel,
  clearChatChannels,
} = chatChannelsSlice.actions;

export const selectChannels = createSelector(
  [(state: RootState) => state.chatChannels.byId, (state: RootState) => state.chatChannels.ids],
  (byId, ids): ChatChannel[] => ids.map((id) => byId[id]),
);

export const selectActiveChannelId = (state: RootState): string | null =>
  state.chatChannels.activeChannelId;

export const selectActiveChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.activeChannelId
    ? state.chatChannels.byId[state.chatChannels.activeChannelId]
    : undefined;

export const selectChannelById = (state: RootState, id: string): ChatChannel | undefined =>
  state.chatChannels.byId[id];

export const sortByLastActivity = (a: ChatChannel, b: ChatChannel): number => {
  const aTime = a.lastMessageAt ?? a.createdAt ?? "";
  const bTime = b.lastMessageAt ?? b.createdAt ?? "";
  return bTime.localeCompare(aTime);
};

// Channels order by root-message activity so thread replies do not reshuffle the list.
export const sortByRootActivity = (a: ChatChannel, b: ChatChannel): number => {
  const aTime = a.lastRootMessageAt ?? a.createdAt ?? "";
  const bTime = b.lastRootMessageAt ?? b.createdAt ?? "";
  return bTime.localeCompare(aTime);
};

export const selectPublicChannels = createSelector([selectChannels], (channels) =>
  channels.filter((c) => c.channelType === "PUBLIC").sort(sortByLastActivity),
);

export const selectPrivateChannels = createSelector([selectChannels], (channels) =>
  channels.filter((c) => c.channelType === "PRIVATE").sort(sortByLastActivity),
);

export const selectDirectMessages = createSelector([selectChannels], (channels) =>
  channels
    .filter((c) => !c.isAgentDm && (c.channelType === "DIRECT" || c.channelType === "GROUP_DM"))
    .sort(sortByLastActivity),
);

export const selectAgentChats = createSelector([selectChannels], (channels) =>
  channels.filter((c) => c.isAgentDm).sort(sortByLastActivity),
);

export const selectChannelMembers = (state: RootState, channelId: string): ChatChannelMember[] =>
  state.chatChannels.channelMembers[channelId] ?? [];

export const selectCategories = (state: RootState): ChatChannelCategory[] =>
  state.chatChannels.categories;

export const selectAgentFolders = (state: RootState): ChatAgentFolder[] =>
  state.chatChannels.agentFolders;

export const selectIsLoading = (state: RootState): boolean => state.chatChannels.isLoading;

export const selectChannelPreferences = (state: RootState): Record<string, ChannelPreferences> =>
  state.chatChannels.channelPreferences;

export const selectSplitChannelId = (state: RootState): string | null =>
  state.chatChannels.splitChannelId;

export const selectSplitChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.splitChannelId
    ? state.chatChannels.byId[state.chatChannels.splitChannelId]
    : undefined;

export const chatChannelsReducer = chatChannelsSlice.reducer;
