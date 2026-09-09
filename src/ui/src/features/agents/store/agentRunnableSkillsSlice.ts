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
  fetchSkillCompatibility,
  type SkillCompatibilityRequest,
  type SerializedSkillCompatibility,
  type RunnableSkillsRequest,
  type SerializedRunnableSkill,
} from "@/features/agents/store/agentRunnableSkillsThunks";

interface AgentRunnableSkillsState {
  organizationId: string | null;
  userId: string | null;
  byAgent: Record<string, SerializedRunnableSkill[]>;
  compatibility: Record<string, SerializedSkillCompatibility[]>;
  requests: Record<string, string>;
  errors: Record<string, string>;
}
const initialState: AgentRunnableSkillsState = {
  organizationId: null,
  userId: null,
  byAgent: {},
  compatibility: {},
  requests: {},
  errors: {},
};
const requestKey = ({ organizationId, agentId, surface }: RunnableSkillsRequest) =>
  `${organizationId}:${agentId}:${surface}`;
const compatibilityKey = ({ organizationId, agentId }: SkillCompatibilityRequest) =>
  `${organizationId}:${agentId}:compatibility`;

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
        const userId = payload.user.id;
        if (organizationId !== state.organizationId || userId !== state.userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addCase(rehydrateComplete, (state, { payload }) => {
        const organizationId = payload.organizationId || state.organizationId;
        const userId = payload.user.id;
        if (organizationId !== state.organizationId || userId !== state.userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addCase(fetchSkillCompatibility.pending, (state, { meta }) => {
        if (state.organizationId !== meta.arg.organizationId) return;
        const key = compatibilityKey(meta.arg);
        state.requests[key] = meta.requestId;
        delete state.compatibility[key];
        delete state.errors[key];
      })
      .addCase(fetchSkillCompatibility.fulfilled, (state, { payload, meta }) => {
        const key = compatibilityKey(meta.arg);
        if (state.requests[key] !== meta.requestId) return;
        state.compatibility[key] = payload.skills;
        delete state.requests[key];
      })
      .addCase(fetchSkillCompatibility.rejected, (state, { meta, payload }) => {
        const key = compatibilityKey(meta.arg);
        if (state.requests[key] !== meta.requestId) return;
        delete state.requests[key];
        state.errors[key] = payload ?? "Failed to check skill compatibility";
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

const EMPTY_COMPATIBILITY: SerializedSkillCompatibility[] = [];
export const selectSkillCompatibility = (agentId: string) => (state: RootState) =>
  state.agentRunnableSkills.compatibility[
    compatibilityKey({
      organizationId: state.auth.currentOrganizationId ?? "",
      agentId,
    })
  ] ?? EMPTY_COMPATIBILITY;

export const selectSkillCompatibilityStatus = (agentId: string) => (state: RootState) => {
  const key = compatibilityKey({
    organizationId: state.auth.currentOrganizationId ?? "",
    agentId,
  });
  return state.agentRunnableSkills.requests[key]
    ? "loading"
    : state.agentRunnableSkills.errors[key]
      ? "failed"
      : "ready";
};
