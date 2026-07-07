import { createAsyncThunk } from '@reduxjs/toolkit';
import { skillsApi } from '@/features/agents/api/skillsApi';
import type { RootState } from '@/app/store';
import type { SkillMetric } from '@uniffy/proto/agents/v1/skills_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

export const skillMetricToPlain = (metric: SkillMetric) => ({
    skillId: metric.skillId,
    displayName: metric.displayName,
    origin: metric.origin,
    injectedCount: metric.injectedCount,
    viewedCount: metric.viewedCount,
    invokedCount: metric.invokedCount,
});

export type SerializedSkillMetric = ReturnType<typeof skillMetricToPlain>;

export interface SkillMetricsResult {
    metrics: SerializedSkillMetric[];
    positiveFeedback: number;
    negativeFeedback: number;
    pendingAgentDrafts: number;
}

export const fetchSkillMetrics = createAsyncThunk<
    SkillMetricsResult,
    void,
    { state: RootState; rejectValue: string }
>('agentSkillMetrics/fetch', async (_arg, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await skillsApi.getSkillMetrics({ organizationId });
        return {
            metrics: response.metrics.map(skillMetricToPlain),
            positiveFeedback: response.positiveFeedbackCount,
            negativeFeedback: response.negativeFeedbackCount,
            pendingAgentDrafts: response.pendingAgentDrafts,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to load skill metrics',
        );
    }
});
