import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import {
  fetchAgents,
  fetchDeletedAgents,
  createAgent,
  cloneAgent,
  updateAgent,
  deleteAgent,
  restoreAgent,
  uploadAgentAvatar,
  deleteAgentAvatar,
} from "@/features/agents/store/agentsThunks";

interface AgentsState {
  agents: Record<string, SerializedAgent>;
  /** Retired agents, kept apart so no picker or list can serve one by accident. */
  deletedAgents: Record<string, SerializedAgent>;
  loading: boolean;
  error: string | null;
}

const initialState: AgentsState = {
  agents: {},
  deletedAgents: {},
  loading: false,
  error: null,
};

export const agentsSlice = createSlice({
  name: "agents",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAgents.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAgents.fulfilled, (state, action) => {
        state.loading = false;
        state.agents = {};
        for (const agent of action.payload) {
          state.agents[agent.id] = agent;
        }
      })
      .addCase(fetchAgents.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to fetch agents";
      })
      .addCase(createAgent.fulfilled, (state, action) => {
        state.agents[action.payload.id] = action.payload;
      })
      .addCase(cloneAgent.fulfilled, (state, action) => {
        state.agents[action.payload.id] = action.payload;
      })
      .addCase(updateAgent.fulfilled, (state, action) => {
        state.agents[action.payload.id] = action.payload;
      })
      .addCase(fetchDeletedAgents.fulfilled, (state, action) => {
        state.deletedAgents = {};
        for (const agent of action.payload) {
          state.deletedAgents[agent.id] = agent;
        }
      })
      .addCase(deleteAgent.fulfilled, (state, action) => {
        const agent = state.agents[action.payload];
        if (agent) {
          state.deletedAgents[agent.id] = { ...agent, isDeleted: true };
        }
        delete state.agents[action.payload];
      })
      .addCase(restoreAgent.fulfilled, (state, action) => {
        delete state.deletedAgents[action.payload.id];
        state.agents[action.payload.id] = action.payload;
      })
      .addCase(uploadAgentAvatar.fulfilled, (state, action) => {
        state.agents[action.payload.id] = action.payload;
      })
      .addCase(deleteAgentAvatar.fulfilled, (state, action) => {
        state.agents[action.payload.id] = action.payload;
      });
  },
});

export const selectAllAgents = (state: RootState) => state.agents.agents;
export const selectDeletedAgents = (state: RootState) => state.agents.deletedAgents;
export const selectAgentById = (id: string) => (state: RootState) =>
  state.agents.agents[id] ?? state.agents.deletedAgents[id] ?? null;
export const selectAgentsLoading = (state: RootState) => state.agents.loading;

export const agentsReducer = agentsSlice.reducer;
