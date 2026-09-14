import { createSlice, createSelector, type PayloadAction } from "@reduxjs/toolkit";
import type {
  ChatChannel,
  ChatChannelMember,
  ChatChannelCategory,
  ChatAgentFolder,
  ChannelPreferences,
} from "@/features/chat/types";
import type { RootState } from "@/app/store";

export interface OrgChatPolicy {
  broadcastMinRole: "member" | "admin";
  broadcastConfirmThreshold: number;
  /** null = unlimited editing; 0 = editing disabled. */
  editWindowMinutes: number | null;
  editHistoryVisibleTo: "admins" | "everyone";
  agentsEnabled: boolean;
}

interface ChatChannelsState {
  byId: Record<string, ChatChannel>;
  ids: string[];
  activeChannelId: string | null;
  splitChannelId: string | null;
  channelMembers: Record<string, ChatChannelMember[]>;
  channelPreferences: Record<string, ChannelPreferences>;
  categories: ChatChannelCategory[];
  agentFolders: ChatAgentFolder[];
  orgPolicy: OrgChatPolicy | null;
  isLoading: boolean;
  channelsLoaded: boolean;
  archivedIds: string[];
  archivedLoaded: boolean;
  archivedRequestId: string | null;
  archivedError: string | null;
  archivedNextCursor: string | null;
  revision: number;
  revisionsById: Record<string, number>;
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
  orgPolicy: null,
  isLoading: false,
  channelsLoaded: false,
  archivedIds: [],
  archivedLoaded: false,
  archivedRequestId: null,
  archivedError: null,
  archivedNextCursor: null,
  revision: 0,
  revisionsById: {},
};

function storeChannel(state: ChatChannelsState, channel: ChatChannel): void {
  const existing = state.byId[channel.id];
  state.byId[channel.id] = {
    ...channel,
    // Single-channel reads omit the folder assigned by ListChannels.
    agentFolderId: channel.agentFolderId ?? existing?.agentFolderId ?? null,
  };
  if (channel.isArchived) {
    state.ids = state.ids.filter((id) => id !== channel.id);
    if (!state.archivedIds.includes(channel.id)) state.archivedIds.push(channel.id);
  } else {
    state.archivedIds = state.archivedIds.filter((id) => id !== channel.id);
    if (!state.ids.includes(channel.id)) state.ids.push(channel.id);
  }
}

function invalidateArchive(state: ChatChannelsState): void {
  state.archivedLoaded = false;
  state.archivedRequestId = null;
  state.archivedError = null;
  state.archivedNextCursor = null;
}

export const chatChannelsSlice = createSlice({
  name: "chatChannels",
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<ChatChannel[]>) => {
      state.byId = Object.fromEntries(
        Object.entries(state.byId).filter(([, channel]) => channel.isArchived),
      );
      state.ids = [];
      for (const channel of action.payload) {
        state.byId[channel.id] = channel;
        state.ids.push(channel.id);
      }
      state.archivedIds = state.archivedIds.filter((id) => state.byId[id]?.isArchived);
      state.channelsLoaded = true;
    },
    archivedLoadStarted: (state, action: PayloadAction<string>) => {
      state.archivedRequestId = action.payload;
      state.archivedError = null;
    },
    setArchivedChannels: (
      state,
      action: PayloadAction<{
        requestId: string;
        channels: ChatChannel[];
        nextCursor: string | null;
        append: boolean;
      }>,
    ) => {
      const { requestId, channels, nextCursor, append } = action.payload;
      if (state.archivedRequestId !== requestId) return;
      if (!append) {
        for (const id of state.archivedIds) delete state.byId[id];
        state.archivedIds = [];
      }
      const ids = new Set(state.archivedIds);
      for (const channel of channels) {
        state.byId[channel.id] = channel;
        ids.add(channel.id);
      }
      state.archivedIds = [...ids];
      state.ids = state.ids.filter((id) => !ids.has(id));
      state.archivedLoaded = true;
      state.archivedNextCursor = nextCursor;
      state.archivedRequestId = null;
    },
    archivedLoadFailed: (state, action: PayloadAction<{ requestId: string; error: string }>) => {
      if (state.archivedRequestId !== action.payload.requestId) return;
      state.archivedRequestId = null;
      state.archivedError = action.payload.error;
    },
    invalidateArchivedChannels: (state, action: PayloadAction<{ clear?: boolean }>) => {
      if (action.payload.clear) {
        state.revision += 1;
        for (const id of state.archivedIds) delete state.byId[id];
        state.archivedIds = [];
      }
      invalidateArchive(state);
    },
    invalidateChannel: (state, action: PayloadAction<string>) => {
      state.revisionsById[action.payload] = (state.revisionsById[action.payload] ?? 0) + 1;
    },
    addChannel: (state, action: PayloadAction<ChatChannel>) => {
      storeChannel(state, action.payload);
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      const channelId = action.payload;
      state.revisionsById[channelId] = (state.revisionsById[channelId] ?? 0) + 1;
      state.archivedIds = state.archivedIds.filter((id) => id !== channelId);
      invalidateArchive(state);
      if (state.byId[channelId]) {
        delete state.byId[channelId];
        state.ids = state.ids.filter((id) => id !== channelId);
      }
      if (state.activeChannelId === channelId) state.activeChannelId = null;
      if (state.splitChannelId === channelId) state.splitChannelId = null;
      delete state.channelMembers[channelId];
      delete state.channelPreferences[channelId];
    },
    setActiveChannel: (state, action: PayloadAction<string | null>) => {
      state.activeChannelId = action.payload;
    },
    updateChannel: (state, action: PayloadAction<ChatChannel>) => {
      if (state.byId[action.payload.id]) storeChannel(state, action.payload);
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
    setOrgChatPolicy: (state, action: PayloadAction<OrgChatPolicy>) => {
      state.orgPolicy = action.payload;
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
    clearChannelCategory: (state, action: PayloadAction<string>) => {
      for (const id of state.ids) {
        const channel = state.byId[id];
        if (channel?.categoryId === action.payload) {
          channel.categoryId = null;
        }
      }
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
  invalidateChannel,
  setChannels,
  setArchivedChannels,
  archivedLoadStarted,
  archivedLoadFailed,
  invalidateArchivedChannels,
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
  clearChannelCategory,
  setAgentFolders,
  upsertAgentFolder,
  removeAgentFolder,
  setChannelAgentFolder,
  setLoading,
  setSplitChannel,
  clearSplitChannel,
  clearChatChannels,
  setOrgChatPolicy,
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

export const selectChannelsLoaded = (state: RootState): boolean =>
  state.chatChannels.channelsLoaded;

export const selectOrgChatPolicy = (state: RootState): OrgChatPolicy | null =>
  state.chatChannels.orgPolicy;

export const selectChannelPreferences = (state: RootState): Record<string, ChannelPreferences> =>
  state.chatChannels.channelPreferences;

export const selectSplitChannelId = (state: RootState): string | null =>
  state.chatChannels.splitChannelId;

export const selectSplitChannel = (state: RootState): ChatChannel | undefined =>
  state.chatChannels.splitChannelId
    ? state.chatChannels.byId[state.chatChannels.splitChannelId]
    : undefined;

export const selectArchivedChannels = createSelector(
  [
    (state: RootState) => state.chatChannels.byId,
    (state: RootState) => state.chatChannels.archivedIds,
  ],
  (byId, ids): ChatChannel[] => ids.map((id) => byId[id]),
);

export const selectArchivedLoaded = (state: RootState): boolean =>
  state.chatChannels.archivedLoaded;

export const chatChannelsReducer = chatChannelsSlice.reducer;
