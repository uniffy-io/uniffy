import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedRunnableSkill } from '@/features/agents/store/agentRunnableSkillsThunks';
import { fetchRunnableSkills } from '@/features/agents/store/agentRunnableSkillsThunks';

interface AgentRunnableSkillsState {
    byAgent: Record<string, SerializedRunnableSkill[]>;
    loadingAgentId: string | null;
}

const initialState: AgentRunnableSkillsState = {
    byAgent: {},
    loadingAgentId: null,
};

export const agentRunnableSkillsSlice = createSlice({
    name: 'agentRunnableSkills',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchRunnableSkills.pending, (state, action) => {
                state.loadingAgentId = action.meta.arg.agentId;
            })
            .addCase(fetchRunnableSkills.fulfilled, (state, action) => {
                state.byAgent[action.payload.agentId] = action.payload.skills;
                if (state.loadingAgentId === action.payload.agentId) {
                    state.loadingAgentId = null;
                }
            })
            .addCase(fetchRunnableSkills.rejected, (state, action) => {
                if (state.loadingAgentId === action.meta.arg.agentId) {
                    state.loadingAgentId = null;
                }
            });
    },
});

const EMPTY: SerializedRunnableSkill[] = [];

export const selectRunnableSkillsForAgent = (agentId: string | null | undefined) =>
    (state: RootState): SerializedRunnableSkill[] =>
        agentId ? (state.agentRunnableSkills.byAgent[agentId] ?? EMPTY) : EMPTY;

export const agentRunnableSkillsReducer = agentRunnableSkillsSlice.reducer;
