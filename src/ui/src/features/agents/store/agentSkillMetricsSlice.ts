import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import {
    fetchSkillMetrics,
    type SerializedSkillMetric,
} from '@/features/agents/store/agentSkillMetricsThunks';

interface AgentSkillMetricsState {
    metrics: SerializedSkillMetric[];
    positiveFeedback: number;
    negativeFeedback: number;
    pendingAgentDrafts: number;
    loading: boolean;
    loaded: boolean;
}

const initialState: AgentSkillMetricsState = {
    metrics: [],
    positiveFeedback: 0,
    negativeFeedback: 0,
    pendingAgentDrafts: 0,
    loading: false,
    loaded: false,
};

export const agentSkillMetricsSlice = createSlice({
    name: 'agentSkillMetrics',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchSkillMetrics.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchSkillMetrics.fulfilled, (state, action) => {
                state.loading = false;
                state.loaded = true;
                state.metrics = action.payload.metrics;
                state.positiveFeedback = action.payload.positiveFeedback;
                state.negativeFeedback = action.payload.negativeFeedback;
                state.pendingAgentDrafts = action.payload.pendingAgentDrafts;
            })
            .addCase(fetchSkillMetrics.rejected, (state) => {
                state.loading = false;
            });
    },
});

export const selectSkillMetricsState = (state: RootState) => state.agentSkillMetrics;

export const agentSkillMetricsReducer = agentSkillMetricsSlice.reducer;
