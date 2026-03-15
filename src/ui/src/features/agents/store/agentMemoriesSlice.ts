import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedMemory } from '@/features/agents/store/agentMemoriesThunks';
import { fetchMemories, createMemory, updateMemory, deleteMemory } from '@/features/agents/store/agentMemoriesThunks';

interface AgentMemoriesState {
    memories: Record<string, SerializedMemory>;
    loading: boolean;
    error: string | null;
}

const initialState: AgentMemoriesState = {
    memories: {},
    loading: false,
    error: null,
};

export const agentMemoriesSlice = createSlice({
    name: 'agentMemories',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchMemories.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchMemories.fulfilled, (state, action) => {
                state.loading = false;
                state.memories = {};
                for (const memory of action.payload) {
                    state.memories[memory.id] = memory;
                }
            })
            .addCase(fetchMemories.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch memories';
            })
            .addCase(createMemory.fulfilled, (state, action) => {
                state.memories[action.payload.id] = action.payload;
            })
            .addCase(updateMemory.fulfilled, (state, action) => {
                state.memories[action.payload.id] = action.payload;
            })
            .addCase(deleteMemory.fulfilled, (state, action) => {
                delete state.memories[action.payload];
            });
    },
});

export const selectAllMemories = (state: RootState) => state.agentMemories.memories;
export const selectMemoriesLoading = (state: RootState) => state.agentMemories.loading;

export const agentMemoriesReducer = agentMemoriesSlice.reducer;
