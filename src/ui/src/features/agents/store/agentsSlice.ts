import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedAgent } from '@/features/agents/store/agentsThunks';
import {
    fetchAgents,
    createAgent,
    cloneAgent,
    updateAgent,
    deleteAgent,
    uploadAgentAvatar,
    deleteAgentAvatar,
} from '@/features/agents/store/agentsThunks';

interface AgentsState {
    agents: Record<string, SerializedAgent>;
    loading: boolean;
    error: string | null;
}

const initialState: AgentsState = {
    agents: {},
    loading: false,
    error: null,
};

export const agentsSlice = createSlice({
    name: 'agents',
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
                state.error = action.payload ?? 'Failed to fetch agents';
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
            .addCase(deleteAgent.fulfilled, (state, action) => {
                delete state.agents[action.payload];
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
export const selectAgentById = (id: string) => (state: RootState) =>
    state.agents.agents[id] ?? null;
export const selectAgentsLoading = (state: RootState) => state.agents.loading;

export const agentsReducer = agentsSlice.reducer;
