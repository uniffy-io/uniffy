import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { UsageStats } from '@/features/agents/store/agentUsageThunks';
import { fetchUsageStats } from '@/features/agents/store/agentUsageThunks';

interface AgentUsageState {
    stats: UsageStats | null;
    loading: boolean;
    error: string | null;
    selectedDays: number;
    selectedInterval: string;
}

const initialState: AgentUsageState = {
    stats: null,
    loading: false,
    error: null,
    selectedDays: 30,
    selectedInterval: '30m',
};

export const agentUsageSlice = createSlice({
    name: 'agentUsage',
    initialState,
    reducers: {
        setSelectedDays: (state, action: PayloadAction<number>) => {
            state.selectedDays = action.payload;
        },
        setSelectedInterval: (state, action: PayloadAction<string>) => {
            state.selectedInterval = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchUsageStats.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchUsageStats.fulfilled, (state, action) => {
                state.loading = false;
                state.stats = action.payload;
            })
            .addCase(fetchUsageStats.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch usage stats';
            });
    },
});

export const { setSelectedDays, setSelectedInterval } = agentUsageSlice.actions;

export const selectUsageStats = (state: RootState) => state.agentUsage.stats;
export const selectUsageLoading = (state: RootState) => state.agentUsage.loading;
export const selectSelectedDays = (state: RootState) => state.agentUsage.selectedDays;
export const selectSelectedInterval = (state: RootState) => state.agentUsage.selectedInterval;

export const agentUsageReducer = agentUsageSlice.reducer;
