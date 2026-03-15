import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedSkill } from '@/features/agents/store/agentSkillsThunks';
import { fetchSkills, createSkill, updateSkill, deleteSkill } from '@/features/agents/store/agentSkillsThunks';

interface AgentSkillsState {
    skills: Record<string, SerializedSkill>;
    loading: boolean;
    error: string | null;
}

const initialState: AgentSkillsState = {
    skills: {},
    loading: false,
    error: null,
};

export const agentSkillsSlice = createSlice({
    name: 'agentSkills',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchSkills.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSkills.fulfilled, (state, action) => {
                state.loading = false;
                state.skills = {};
                for (const skill of action.payload) {
                    state.skills[skill.id] = skill;
                }
            })
            .addCase(fetchSkills.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch skills';
            })
            .addCase(createSkill.fulfilled, (state, action) => {
                state.skills[action.payload.id] = action.payload;
            })
            .addCase(updateSkill.fulfilled, (state, action) => {
                state.skills[action.payload.id] = action.payload;
            })
            .addCase(deleteSkill.fulfilled, (state, action) => {
                delete state.skills[action.payload];
            });
    },
});

export const selectAllSkills = (state: RootState) => state.agentSkills.skills;
export const selectSkillById = (id: string) => (state: RootState) =>
    state.agentSkills.skills[id] ?? null;
export const selectSkillsLoading = (state: RootState) => state.agentSkills.loading;

export const agentSkillsReducer = agentSkillsSlice.reducer;
