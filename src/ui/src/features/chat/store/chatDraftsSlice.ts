import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlainDraft } from "@/features/chat/api/chatConverters";
import type { RootState } from "@/app/store";

export interface ChatDraftEntry {
  content: string;
  updatedAt: string;
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

// Thread keys collapse to their channel so the sidebar pencil covers both draft kinds.
export const selectChannelsWithDrafts = createSelector(
  [(state: RootState) => state.chatDrafts.byKey],
  (byKey): Set<string> => {
    const channels = new Set<string>();
    for (const key of Object.keys(byKey)) {
      const separator = key.indexOf(":");
      channels.add(separator === -1 ? key : key.slice(0, separator));
    }
    return channels;
  },
);

export const chatDraftsReducer = chatDraftsSlice.reducer;
