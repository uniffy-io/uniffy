import { createAsyncThunk } from '@reduxjs/toolkit';
import { runtimeApi } from '@/features/agents/api/runtimeApi';
import type { RootState } from '@/app/store';

interface DailyUsageEntry {
    date: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cost: string;
    imageCount: number;
}

interface ModelUsageEntry {
    model: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    cost: string;
    imageCount: number;
}

interface AgentUsageEntry {
    agentId: string;
    agentName: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
}

interface ToolUsageEntry {
    toolName: string;
    callCount: number;
}

interface ProviderKeyUsageEntry {
    providerKeyId: string;
    keyLabel: string;
    provider: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
}

interface CronTaskUsageEntry {
    cronTaskId: string;
    taskName: string;
    agentName: string;
    totalRuns: number;
    successes: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
}

export interface UsageStats {
    totalRuns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadInputTokens: number;
    totalSessions: number;
    avgDurationMs: number;
    totalCost: string;
    displayCurrency: string;
    totalThinkingTokens: number;
    totalImageCount: number;
    totalRetries: number;
    totalCancelled: number;
    totalDeadlineExceeded: number;
    dailyUsage: DailyUsageEntry[];
    modelUsage: ModelUsageEntry[];
    agentUsage: AgentUsageEntry[];
    toolUsage: ToolUsageEntry[];
    providerKeyUsage: ProviderKeyUsageEntry[];
    cronUsage: CronTaskUsageEntry[];
    cronTotalRuns: number;
    cronTotalSuccesses: number;
    cronTotalFailures: number;
    cronTotalInputTokens: number;
    cronTotalOutputTokens: number;
}

export const fetchUsageStats = createAsyncThunk<
    UsageStats,
    { days?: number; interval?: string },
    { state: RootState; rejectValue: string }
>('agentUsage/fetchUsageStats', async (params, { getState, rejectWithValue }) => {
    try {
        const orgId = getState().auth.currentOrganizationId;
        if (!orgId) throw new Error('No organization selected');

        const response = await runtimeApi.getUsageStats({
            organizationId: orgId,
            days: params.days ?? 30,
            interval: params.interval ?? '1d',
        });

        return {
            totalRuns: Number(response.totalRuns),
            totalInputTokens: Number(response.totalInputTokens),
            totalOutputTokens: Number(response.totalOutputTokens),
            totalCacheReadInputTokens: Number(response.totalCacheReadInputTokens),
            totalSessions: Number(response.totalSessions),
            avgDurationMs: response.avgDurationMs,
            totalCost: response.totalCost || '0',
            displayCurrency: response.displayCurrency || 'USD',
            totalThinkingTokens: Number(response.totalThinkingTokens),
            totalImageCount: Number(response.totalImageCount),
            totalRetries: Number(response.totalRetries),
            totalCancelled: Number(response.totalCancelled),
            totalDeadlineExceeded: Number(response.totalDeadlineExceeded),
            dailyUsage: response.dailyUsage.map((d) => ({
                date: d.date,
                runs: Number(d.runs),
                inputTokens: Number(d.inputTokens),
                outputTokens: Number(d.outputTokens),
                cacheReadInputTokens: Number(d.cacheReadInputTokens),
                cost: d.cost || '0',
                imageCount: Number(d.imageCount),
            })),
            modelUsage: response.modelUsage.map((m) => ({
                model: m.model,
                runs: Number(m.runs),
                inputTokens: Number(m.inputTokens),
                outputTokens: Number(m.outputTokens),
                cost: m.cost || '0',
                imageCount: Number(m.imageCount),
            })),
            agentUsage: response.agentUsage.map((a) => ({
                agentId: a.agentId,
                agentName: a.agentName,
                runs: Number(a.runs),
                inputTokens: Number(a.inputTokens),
                outputTokens: Number(a.outputTokens),
            })),
            toolUsage: response.toolUsage.map((t) => ({
                toolName: t.toolName,
                callCount: Number(t.callCount),
            })),
            providerKeyUsage: response.providerKeyUsage.map((p) => ({
                providerKeyId: p.providerKeyId,
                keyLabel: p.keyLabel,
                provider: p.provider,
                runs: Number(p.runs),
                inputTokens: Number(p.inputTokens),
                outputTokens: Number(p.outputTokens),
            })),
            cronUsage: response.cronUsage.map((c) => ({
                cronTaskId: c.cronTaskId,
                taskName: c.taskName,
                agentName: c.agentName,
                totalRuns: Number(c.totalRuns),
                successes: Number(c.successes),
                failures: Number(c.failures),
                inputTokens: Number(c.inputTokens),
                outputTokens: Number(c.outputTokens),
            })),
            cronTotalRuns: Number(response.cronTotalRuns),
            cronTotalSuccesses: Number(response.cronTotalSuccesses),
            cronTotalFailures: Number(response.cronTotalFailures),
            cronTotalInputTokens: Number(response.cronTotalInputTokens),
            cronTotalOutputTokens: Number(response.cronTotalOutputTokens),
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch usage stats');
    }
});
