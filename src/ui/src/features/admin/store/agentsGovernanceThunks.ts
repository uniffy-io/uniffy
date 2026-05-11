/**
 * Async thunks for the agents governance admin surface.
 *
 * Calls the BudgetsService and RateLimitsService through
 * agentsGovernanceApi. Errors propagate to the global toast
 * middleware - never raise toast manually here.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { agentsGovernanceApi } from '@/features/admin/api/agentsGovernanceApi';
import type { OrgBudget, UserQuota } from '@uniffy/proto/agents/v1/budgets_pb';
import type { RateLimit } from '@uniffy/proto/agents/v1/rate_limits_pb';
import type {
    OrgBudgetState,
    SpendState,
    RateLimitState,
} from './agentsGovernanceSlice';

function serialiseBudget(row: OrgBudget): OrgBudgetState {
    return {
        id: row.id,
        monthlyLimitUsd: row.monthlyLimitUsd ?? null,
        imageMonthlyLimit: row.imageMonthlyLimit ?? null,
        hardLimit: row.hardLimit,
        alertThresholds: [...row.alertThresholds],
        resetDay: row.resetDay,
    };
}

function serialiseRateLimit(row: RateLimit): RateLimitState {
    return {
        kind: row.kind,
        limit: row.limit,
        windowSeconds: row.windowSeconds,
        isOverride: row.isOverride,
    };
}

function requireOrg(getState: () => RootState): string {
    const orgId = getState().auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
}

// --- Budget ---

export const fetchOrgBudget = createAsyncThunk<
    OrgBudgetState | null,
    void,
    { state: RootState }
>('agentsGovernance/fetchOrgBudget', async (_, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.getOrgBudget({ organizationId });
    return resp.budget ? serialiseBudget(resp.budget) : null;
});

export interface UpdateOrgBudgetArgs {
    monthlyLimitUsd?: string | null;
    imageMonthlyLimit?: number | null;
    hardLimit: boolean;
    alertThresholds: number[];
    resetDay: number;
}

export const updateOrgBudget = createAsyncThunk<
    OrgBudgetState,
    UpdateOrgBudgetArgs,
    { state: RootState }
>('agentsGovernance/updateOrgBudget', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.updateOrgBudget({
        organizationId,
        monthlyLimitUsd: args.monthlyLimitUsd ?? undefined,
        imageMonthlyLimit: args.imageMonthlyLimit ?? undefined,
        hardLimit: args.hardLimit,
        alertThresholds: args.alertThresholds,
        resetDay: args.resetDay,
    });
    if (!resp.budget) throw new Error('Empty budget response');
    return serialiseBudget(resp.budget);
});

export const deleteOrgBudget = createAsyncThunk<void, void, { state: RootState }>(
    'agentsGovernance/deleteOrgBudget',
    async (_, { getState }) => {
        const organizationId = requireOrg(getState);
        await agentsGovernanceApi.deleteOrgBudget({ organizationId });
    },
);

export const fetchCurrentSpend = createAsyncThunk<
    SpendState,
    void,
    { state: RootState }
>('agentsGovernance/fetchCurrentSpend', async (_, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.getCurrentSpend({ organizationId });
    const summary = resp.summary;
    return {
        spendUsd: summary?.spendUsd ?? '0',
        imageCount: summary?.imageCount ?? 0,
        periodStart: summary?.periodStart
            ? new Date(Number(summary.periodStart.seconds) * 1000).toISOString()
            : null,
        periodEnd: summary?.periodEnd
            ? new Date(Number(summary.periodEnd.seconds) * 1000).toISOString()
            : null,
    };
});

// --- Rate limits ---

export const fetchRateLimits = createAsyncThunk<
    RateLimitState[],
    void,
    { state: RootState }
>('agentsGovernance/fetchRateLimits', async (_, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.getRateLimits({ organizationId });
    return resp.limits.map(serialiseRateLimit);
});

export interface UpsertRateLimitArgs {
    kind: number;
    limit: number;
    windowSeconds: number;
}

export const upsertRateLimit = createAsyncThunk<
    RateLimitState,
    UpsertRateLimitArgs,
    { state: RootState }
>('agentsGovernance/upsertRateLimit', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.upsertRateLimit({
        organizationId,
        kind: args.kind,
        limit: args.limit,
        windowSeconds: args.windowSeconds,
    });
    if (!resp.limit) throw new Error('Empty rate limit response');
    return serialiseRateLimit(resp.limit);
});

export const deleteRateLimit = createAsyncThunk<
    number,
    { kind: number },
    { state: RootState }
>('agentsGovernance/deleteRateLimit', async ({ kind }, { getState }) => {
    const organizationId = requireOrg(getState);
    await agentsGovernanceApi.deleteRateLimit({ organizationId, kind });
    return kind;
});

// --- User quota (used by member edit dialog batch later) ---

export interface UpsertUserQuotaArgs {
    userId: string;
    dailyLimitUsd?: string | null;
    monthlyLimitUsd?: string | null;
    dailyImageLimit?: number | null;
    monthlyImageLimit?: number | null;
    hardLimit: boolean;
}

export const upsertUserQuota = createAsyncThunk<
    UserQuota,
    UpsertUserQuotaArgs,
    { state: RootState }
>('agentsGovernance/upsertUserQuota', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.updateUserQuota({
        organizationId,
        userId: args.userId,
        dailyLimitUsd: args.dailyLimitUsd ?? undefined,
        monthlyLimitUsd: args.monthlyLimitUsd ?? undefined,
        dailyImageLimit: args.dailyImageLimit ?? undefined,
        monthlyImageLimit: args.monthlyImageLimit ?? undefined,
        hardLimit: args.hardLimit,
    });
    if (!resp.quota) throw new Error('Empty quota response');
    return resp.quota;
});

export const deleteUserQuota = createAsyncThunk<
    void,
    { userId: string },
    { state: RootState }
>('agentsGovernance/deleteUserQuota', async ({ userId }, { getState }) => {
    const organizationId = requireOrg(getState);
    await agentsGovernanceApi.deleteUserQuota({ organizationId, userId });
});

export const fetchUserQuota = createAsyncThunk<
    UserQuota | null,
    { userId: string },
    { state: RootState }
>('agentsGovernance/fetchUserQuota', async ({ userId }, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.getUserQuota({ organizationId, userId });
    return resp.quota ?? null;
});
