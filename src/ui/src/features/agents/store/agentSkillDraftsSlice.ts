import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import {
    fetchSkillDrafts,
    createSkillDraft,
    saveSkillDraft,
    discardSkillDraft,
    type SerializedSkillDraft,
} from '@/features/agents/store/agentSkillDraftsThunks';

interface AgentSkillDraftsState {
    byId: Record<string, SerializedSkillDraft>;
    // Pending drafts for the review inbox (newest first).
    inboxIds: string[];
    // Drafts an agent proposed during a given session, for inline review cards.
    idsBySession: Record<string, string[]>;
    loading: boolean;
}

const initialState: AgentSkillDraftsState = {
    byId: {},
    inboxIds: [],
    idsBySession: {},
    loading: false,
};

const dropFromInbox = (state: AgentSkillDraftsState, draftId: string) => {
    state.inboxIds = state.inboxIds.filter((id) => id !== draftId);
};

export const agentSkillDraftsSlice = createSlice({
    name: 'agentSkillDrafts',
    initialState,
    reducers: {
        upsertProposedDraft: (
            state,
            action: PayloadAction<{ draft: SerializedSkillDraft; sessionId?: string }>,
        ) => {
            const { draft, sessionId } = action.payload;
            state.byId[draft.id] = draft;
            if (draft.status === 'pending' && !state.inboxIds.includes(draft.id)) {
                state.inboxIds.unshift(draft.id);
            }
            const key = sessionId ?? draft.sessionId;
            if (key) {
                const list = state.idsBySession[key] ?? [];
                if (!list.includes(draft.id)) state.idsBySession[key] = [...list, draft.id];
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchSkillDrafts.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchSkillDrafts.fulfilled, (state, action) => {
                state.loading = false;
                state.inboxIds = action.payload.map((d) => d.id);
                for (const draft of action.payload) {
                    state.byId[draft.id] = draft;
                }
            })
            .addCase(fetchSkillDrafts.rejected, (state) => {
                state.loading = false;
            })
            .addCase(createSkillDraft.fulfilled, (state, action) => {
                const draft = action.payload;
                state.byId[draft.id] = draft;
                if (draft.status === 'pending' && !state.inboxIds.includes(draft.id)) {
                    state.inboxIds.unshift(draft.id);
                }
            })
            .addCase(saveSkillDraft.fulfilled, (state, action) => {
                const { draftId } = action.payload;
                const existing = state.byId[draftId];
                if (existing) existing.status = 'saved';
                dropFromInbox(state, draftId);
            })
            .addCase(discardSkillDraft.fulfilled, (state, action) => {
                const draftId = action.payload;
                const existing = state.byId[draftId];
                if (existing) existing.status = 'discarded';
                dropFromInbox(state, draftId);
            });
    },
});

export const { upsertProposedDraft } = agentSkillDraftsSlice.actions;

const EMPTY: SerializedSkillDraft[] = [];

export const selectDraftById = (id: string) => (state: RootState) =>
    state.agentSkillDrafts.byId[id] ?? null;

export const selectInboxDrafts = (state: RootState): SerializedSkillDraft[] =>
    state.agentSkillDrafts.inboxIds
        .map((id) => state.agentSkillDrafts.byId[id])
        .filter((d): d is SerializedSkillDraft => Boolean(d));

export const selectInboxCount = (state: RootState): number =>
    state.agentSkillDrafts.inboxIds.length;

export const selectSessionDrafts = (sessionId: string | null | undefined) =>
    (state: RootState): SerializedSkillDraft[] => {
        if (!sessionId) return EMPTY;
        const ids = state.agentSkillDrafts.idsBySession[sessionId];
        if (!ids || ids.length === 0) return EMPTY;
        return ids
            .map((id) => state.agentSkillDrafts.byId[id])
            .filter((d): d is SerializedSkillDraft => Boolean(d));
    };

export const selectDraftsLoading = (state: RootState) => state.agentSkillDrafts.loading;

export const agentSkillDraftsReducer = agentSkillDraftsSlice.reducer;
