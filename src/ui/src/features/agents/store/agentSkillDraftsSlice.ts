import {
  createSelector,
  createSlice,
  isAnyOf,
  isFulfilled,
  isPending,
  isRejected,
} from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";
import {
  fetchSkillDrafts,
  fetchSkillDraft,
  createSkillDraft,
  generateSkillDraft,
  retrySkillDraftGeneration,
  saveSkillDraft,
  discardSkillDraft,
  type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";

interface AgentSkillDraftsState {
  organizationId: string | null;
  userId: string | null;
  requests: Record<string, true>;
  byId: Record<string, SerializedSkillDraft>;
  inboxIds: string[];
  loading: boolean;
}

const initialState: AgentSkillDraftsState = {
  organizationId: null,
  userId: null,
  requests: {},
  byId: {},
  inboxIds: [],
  loading: false,
};

const draftRequests = [
  fetchSkillDrafts,
  fetchSkillDraft,
  createSkillDraft,
  generateSkillDraft,
  retrySkillDraftGeneration,
  saveSkillDraft,
  discardSkillDraft,
] as const;

export const isOpenSkillDraft = (status: string) =>
  ["pending", "generating", "generation_failed"].includes(status);

function storeDraft(state: AgentSkillDraftsState, draft: SerializedSkillDraft) {
  const existing = state.byId[draft.id];
  if (existing) {
    if (existing.generationAttempt > draft.generationAttempt) return;
    if (!isOpenSkillDraft(existing.status)) return;
    const previousTime = existing.updatedAt;
    const nextTime = draft.updatedAt;
    if (
      previousTime &&
      nextTime &&
      (previousTime.seconds > nextTime.seconds ||
        (previousTime.seconds === nextTime.seconds && previousTime.nanos > nextTime.nanos))
    ) {
      return;
    }
  }
  state.byId[draft.id] = draft;
  if (isOpenSkillDraft(draft.status)) {
    if (!state.inboxIds.includes(draft.id)) state.inboxIds.unshift(draft.id);
  } else {
    state.inboxIds = state.inboxIds.filter((id) => id !== draft.id);
  }
}

export const agentSkillDraftsSlice = createSlice({
  name: "agentSkillDrafts",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logout, () => initialState)
      .addCase(rehydrateFailed, () => initialState)
      .addCase(setCredentials, (state, { payload }) => {
        const organizationId = payload.organizationId || null;
        const userId = payload.user?.id || null;
        if (state.organizationId !== organizationId || state.userId !== userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addCase(rehydrateComplete, (state, { payload }) => {
        const organizationId = payload.organizationId || state.organizationId;
        const userId = payload.user.id;
        if (state.organizationId !== organizationId || state.userId !== userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addCase(fetchSkillDrafts.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchSkillDrafts.fulfilled, (state, { payload, meta }) => {
        if (!state.requests[meta.requestId]) return;
        state.loading = false;
        for (const draft of payload) storeDraft(state, draft);
        state.inboxIds = payload
          .filter((draft) => isOpenSkillDraft(state.byId[draft.id].status))
          .map((draft) => draft.id);
      })
      .addCase(fetchSkillDrafts.rejected, (state, { meta }) => {
        if (state.requests[meta.requestId]) state.loading = false;
      })
      .addCase(saveSkillDraft.fulfilled, (state, { payload, meta }) => {
        if (!state.requests[meta.requestId]) return;
        const existing = state.byId[payload.draftId];
        if (existing) existing.status = "saved";
        state.inboxIds = state.inboxIds.filter((id) => id !== payload.draftId);
      })
      .addCase(discardSkillDraft.fulfilled, (state, { payload, meta }) => {
        if (!state.requests[meta.requestId]) return;
        const existing = state.byId[payload];
        if (existing) existing.status = "discarded";
        state.inboxIds = state.inboxIds.filter((id) => id !== payload);
      })
      .addMatcher(
        isAnyOf(
          fetchSkillDraft.fulfilled,
          createSkillDraft.fulfilled,
          generateSkillDraft.fulfilled,
          retrySkillDraftGeneration.fulfilled,
        ),
        (state, { payload, meta }) => {
          if (state.requests[meta.requestId]) storeDraft(state, payload);
        },
      )
      .addMatcher(isPending(...draftRequests), (state, { meta }) => {
        state.requests[meta.requestId] = true;
      })
      .addMatcher(
        isAnyOf(isFulfilled(...draftRequests), isRejected(...draftRequests)),
        (state, { meta }) => {
          delete state.requests[meta.requestId];
        },
      );
  },
});

export const selectDraftById = (id: string) => (state: RootState) =>
  state.agentSkillDrafts.byId[id] ?? null;

export const selectInboxDrafts = createSelector(
  [(state: RootState) => state.agentSkillDrafts],
  (state) => state.inboxIds.map((id) => state.byId[id]).filter(Boolean),
);

export const selectInboxCount = (state: RootState) => state.agentSkillDrafts.inboxIds.length;

export const selectSessionDrafts = (sessionId: string | null | undefined) =>
  createSelector([(state: RootState) => state.agentSkillDrafts.byId], (drafts) =>
    Object.values(drafts).filter((draft) => sessionId && draft.sessionId === sessionId),
  );

export const selectDraftsLoading = (state: RootState) => state.agentSkillDrafts.loading;
export const agentSkillDraftsReducer = agentSkillDraftsSlice.reducer;
