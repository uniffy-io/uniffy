import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedAgentTemplate } from '@/features/agents/store/agentTemplatesThunks';
import { fetchAgentTemplates } from '@/features/agents/store/agentTemplatesThunks';

interface AgentTemplatesState {
    templates: SerializedAgentTemplate[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
}

const initialState: AgentTemplatesState = {
    templates: [],
    loading: false,
    loaded: false,
    error: null,
};

export const agentTemplatesSlice = createSlice({
    name: 'agentTemplates',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchAgentTemplates.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchAgentTemplates.fulfilled, (state, action) => {
                state.loading = false;
                state.loaded = true;
                state.templates = action.payload;
            })
            .addCase(fetchAgentTemplates.rejected, (state, action) => {
                state.loading = false;
                state.loaded = true;
                state.error = action.payload ?? 'Failed to fetch agent templates';
            });
    },
});

export const selectAgentTemplates = (state: RootState) => state.agentTemplates.templates;
export const selectAgentTemplatesLoading = (state: RootState) => state.agentTemplates.loading;
export const selectAgentTemplatesLoaded = (state: RootState) => state.agentTemplates.loaded;

export const agentTemplatesReducer = agentTemplatesSlice.reducer;
