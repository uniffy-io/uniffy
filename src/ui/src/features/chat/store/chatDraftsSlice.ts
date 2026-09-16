import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlainDraft } from "@/features/chat/api/chatConverters";
import type { RootState } from "@/app/store";

export interface ChatDraftEntry {
  content: string;
  updatedAt: string;
}

/** One unsent draft with its key parsed back into the channel and thread it belongs to. */
export interface ChatDraftRow extends ChatDraftEntry {
  key: string;
  channelId: string;
  rootMessageId: string | null;
}

interface ChatDraftsState {
  byKey: Record<string, ChatDraftEntry>;
}

const initialState: ChatDraftsState = {
  byKey: {},
};

export function draftKey(channelId: string, rootMessageId?: string): string {
  return rootMessageId ? `${channelId}:${rootMessageId}` : channelId;
}

export const chatDraftsSlice = createSlice({
  name: "chatDrafts",
  initialState,
  reducers: {
    setDrafts: (state, action: PayloadAction<PlainDraft[]>) => {
      state.byKey = {};
      for (const draft of action.payload) {
        state.byKey[draftKey(draft.channelId, draft.rootMessageId ?? undefined)] = {
          content: draft.content,
          updatedAt: draft.updatedAt,
        };
      }
    },
    draftUpserted: (state, action: PayloadAction<PlainDraft>) => {
      const draft = action.payload;
      state.byKey[draftKey(draft.channelId, draft.rootMessageId ?? undefined)] = {
        content: draft.content,
        updatedAt: draft.updatedAt,
      };
    },
    draftRemoved: (state, action: PayloadAction<string>) => {
      delete state.byKey[action.payload];
    },
    clearChatDrafts: () => initialState,
  },
});

export const { setDrafts, draftUpserted, draftRemoved, clearChatDrafts } = chatDraftsSlice.actions;

export const selectDraft = (state: RootState, key: string): ChatDraftEntry | undefined =>
  state.chatDrafts.byKey[key];

export function selectActiveDraftKey(state: RootState, pathname: string): string | null {
  if (pathname !== "/chat" && !pathname.startsWith("/chat/")) return null;
  const channelId =
    state.chatUi.splitActive && state.chatUi.focusedPane === "right"
      ? state.chatChannels.splitChannelId
      : pathname === "/chat"
        ? state.chatChannels.activeChannelId
        : /^\/chat\/([^/]+)\/?$/.exec(pathname)?.[1];
  const channel = channelId ? state.chatChannels.byId[channelId] : undefined;
  if (!channel || channel.isArchived || channel.agentIsRetired) return null;
  const rootId = state.chatUi.threadPanelOpen ? state.chatThreads.activeThreadId : null;
  if (rootId && state.chatMessages.byId[rootId]?.channelId === channel.id) {
    return draftKey(channel.id, rootId);
  }
  return channel.id;
}

// Thread keys collapse to their channel so the sidebar pencil covers both draft kinds.
export const selectChannelsWithDrafts = createSelector(
  [
    (state: RootState) => state.chatDrafts.byKey,
    (_state: RootState, activeKey: string | null = null) => activeKey,
  ],
  (byKey, activeKey): Set<string> => {
    const channels = new Set<string>();
    for (const key of Object.keys(byKey)) {
      if (key === activeKey) continue;
      const separator = key.indexOf(":");
      channels.add(separator === -1 ? key : key.slice(0, separator));
    }
    return channels;
  },
);

/** Newest first, matching the order ListDrafts returns. */
export const selectDraftRows = createSelector(
  [(state: RootState) => state.chatDrafts.byKey],
  (byKey): ChatDraftRow[] =>
    Object.entries(byKey)
      .map(([key, entry]) => {
        const separator = key.indexOf(":");
        return {
          key,
          channelId: separator === -1 ? key : key.slice(0, separator),
          rootMessageId: separator === -1 ? null : key.slice(separator + 1),
          content: entry.content,
          updatedAt: entry.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);

export const selectDraftCount = (state: RootState, activeKey: string | null = null): number =>
  Object.keys(state.chatDrafts.byKey).filter((key) => key !== activeKey).length;

export const chatDraftsReducer = chatDraftsSlice.reducer;
