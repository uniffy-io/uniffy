import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";
import {
  fetchRunnableSkills,
  type RunnableSkillsRequest,
  type SerializedRunnableSkill,
} from "@/features/agents/store/agentRunnableSkillsThunks";

interface AgentRunnableSkillsState {
  organizationId: string | null;
  byAgent: Record<string, SerializedRunnableSkill[]>;
  requests: Record<string, string>;
  errors: Record<string, string>;
}
const initialState: AgentRunnableSkillsState = {
  organizationId: null,
  byAgent: {},
  requests: {},
  errors: {},
};
const requestKey = ({ organizationId, agentId, surface }: RunnableSkillsRequest) =>
  `${organizationId}:${agentId}:${surface}`;

export const agentRunnableSkillsSlice = createSlice({
  name: "agentRunnableSkills",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logout, () => initialState)
      .addCase(rehydrateFailed, () => initialState)
      .addCase(setCredentials, (state, { payload }) => {
        const organizationId = payload.organizationId || null;
        if (organizationId !== state.organizationId) {
          return { ...initialState, organizationId };
        }
      })
      .addCase(rehydrateComplete, (state, { payload }) => {
        if (payload.organizationId && payload.organizationId !== state.organizationId) {
          return { ...initialState, organizationId: payload.organizationId };
        }
      })
      .addCase(fetchRunnableSkills.pending, (state, { meta }) => {
        if (state.organizationId !== meta.arg.organizationId) return;
        const key = requestKey(meta.arg);
        state.requests[key] = meta.requestId;
        delete state.errors[key];
      })
      .addCase(fetchRunnableSkills.fulfilled, (state, { payload, meta }) => {
        const key = requestKey(meta.arg);
        if (state.requests[key] !== meta.requestId) return;
        state.byAgent[key] = payload.skills;
        delete state.requests[key];
      })
      .addCase(fetchRunnableSkills.rejected, (state, { payload, meta }) => {
        const key = requestKey(meta.arg);
        if (state.requests[key] !== meta.requestId) return;
        delete state.byAgent[key];
        delete state.requests[key];
        state.errors[key] = payload ?? "Failed to fetch runnable skills";
      });
  },
});
const EMPTY: SerializedRunnableSkill[] = [];
export const selectRunnableSkillsForAgent =
  (agentId: string | null | undefined, surface: "session" | "chat") =>
  (state: RootState): SerializedRunnableSkill[] => {
    const organizationId = state.auth.currentOrganizationId;
    return agentId && organizationId
      ? (state.agentRunnableSkills.byAgent[requestKey({ organizationId, agentId, surface })] ??
          EMPTY)
      : EMPTY;
  };
export const selectRunnableSkillsStatus =
  (agentId: string, surface: "session" | "chat") => (state: RootState) => {
    const key = requestKey({
      organizationId: state.auth.currentOrganizationId ?? "",
      agentId,
      surface,
    });
    return state.agentRunnableSkills.requests[key]
      ? "loading"
      : state.agentRunnableSkills.errors[key]
        ? "failed"
        : "ready";
  };
export const agentRunnableSkillsReducer = agentRunnableSkillsSlice.reducer;
