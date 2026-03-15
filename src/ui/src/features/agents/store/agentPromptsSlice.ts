import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedPrompt } from '@/features/agents/store/agentPromptsThunks';
import { fetchPrompts, createPrompt, updatePrompt, deletePrompt } from '@/features/agents/store/agentPromptsThunks';

interface AgentPromptsState {
    prompts: Record<string, SerializedPrompt>;
    loading: boolean;
    error: string | null;
}

const initialState: AgentPromptsState = {
    prompts: {},
    loading: false,
    error: null,
};

export const agentPromptsSlice = createSlice({
    name: 'agentPrompts',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchPrompts.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchPrompts.fulfilled, (state, action) => {
                state.loading = false;
                state.prompts = {};
                for (const prompt of action.payload) {
                    state.prompts[prompt.id] = prompt;
                }
            })
            .addCase(fetchPrompts.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch prompts';
            })
            .addCase(createPrompt.fulfilled, (state, action) => {
                state.prompts[action.payload.id] = action.payload;
            })
            .addCase(updatePrompt.fulfilled, (state, action) => {
                state.prompts[action.payload.id] = action.payload;
            })
            .addCase(deletePrompt.fulfilled, (state, action) => {
                delete state.prompts[action.payload];
            });
    },
});

export const selectAllPrompts = (state: RootState) => state.agentPrompts.prompts;
export const selectPromptById = (id: string) => (state: RootState) =>
    state.agentPrompts.prompts[id] ?? null;
export const selectPromptsLoading = (state: RootState) => state.agentPrompts.loading;

export const agentPromptsReducer = agentPromptsSlice.reducer;
