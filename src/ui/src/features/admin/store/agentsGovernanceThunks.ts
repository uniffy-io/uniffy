import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { agentsGovernanceApi } from '@/features/admin/api/agentsGovernanceApi';
import type { CurrencyRate, OrgBudget, UserQuota } from '@uniffy/proto/agents/v1/budgets_pb';
import type { RateLimit } from '@uniffy/proto/agents/v1/rate_limits_pb';
import type {
    CurrencyRateState,
    OrgBudgetState,
    SpendState,
    RateLimitState,
} from './agentsGovernanceSlice';

function serialiseBudget(row: OrgBudget): OrgBudgetState {
    return {
        id: row.id,
        monthlyLimit: row.monthlyLimit ?? null,
        imageMonthlyLimit: row.imageMonthlyLimit ?? null,
        hardLimit: row.hardLimit,
        alertThresholds: [...row.alertThresholds],
        resetDay: row.resetDay,
        currency: row.currency || 'USD',
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

function serialiseCurrencyRate(row: CurrencyRate): CurrencyRateState {
    return {
        fromCurrency: row.fromCurrency,
        toCurrency: row.toCurrency,
        rate: row.rate,
        updatedAt: row.updatedAt
            ? new Date(Number(row.updatedAt.seconds) * 1000).toISOString()
            : new Date().toISOString(),
    };
}

function requireOrg(getState: () => RootState): string {
    const orgId = getState().auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
}

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
    monthlyLimit?: string | null;
    imageMonthlyLimit?: number | null;
    hardLimit: boolean;
    alertThresholds: number[];
    resetDay: number;
    currency?: string;
}

export const updateOrgBudget = createAsyncThunk<
    OrgBudgetState,
    UpdateOrgBudgetArgs,
    { state: RootState }
>('agentsGovernance/updateOrgBudget', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.updateOrgBudget({
        organizationId,
        monthlyLimit: args.monthlyLimit ?? undefined,
        imageMonthlyLimit: args.imageMonthlyLimit ?? undefined,
        hardLimit: args.hardLimit,
        alertThresholds: args.alertThresholds,
        resetDay: args.resetDay,
        currency: args.currency ?? '',
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
        spend: summary?.spend ?? '0',
        currency: summary?.currency ?? 'USD',
        imageCount: summary?.imageCount ?? 0,
        periodStart: summary?.periodStart
            ? new Date(Number(summary.periodStart.seconds) * 1000).toISOString()
            : null,
        periodEnd: summary?.periodEnd
            ? new Date(Number(summary.periodEnd.seconds) * 1000).toISOString()
            : null,
    };
});

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

export const fetchCurrencyRates = createAsyncThunk<
    CurrencyRateState[],
    void,
    { state: RootState }
>('agentsGovernance/fetchCurrencyRates', async (_, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.listCurrencyRates({ organizationId });
    return resp.rates.map(serialiseCurrencyRate);
});

export interface UpsertCurrencyRateArgs {
    fromCurrency: string;
    toCurrency: string;
    rate: string;
}

export const upsertCurrencyRate = createAsyncThunk<
    CurrencyRateState,
    UpsertCurrencyRateArgs,
    { state: RootState }
>('agentsGovernance/upsertCurrencyRate', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.upsertCurrencyRate({
        organizationId,
        fromCurrency: args.fromCurrency,
        toCurrency: args.toCurrency,
        rate: args.rate,
    });
    if (!resp.rate) throw new Error('Empty currency-rate response');
    return serialiseCurrencyRate(resp.rate);
});

export const deleteCurrencyRate = createAsyncThunk<
    { from: string; to: string },
    { fromCurrency: string; toCurrency: string },
    { state: RootState }
>('agentsGovernance/deleteCurrencyRate', async (args, { getState }) => {
    const organizationId = requireOrg(getState);
    await agentsGovernanceApi.deleteCurrencyRate({
        organizationId,
        fromCurrency: args.fromCurrency,
        toCurrency: args.toCurrency,
    });
    return { from: args.fromCurrency, to: args.toCurrency };
});

export const fetchDisplayCurrency = createAsyncThunk<
    string,
    void,
    { state: RootState }
>('agentsGovernance/fetchDisplayCurrency', async (_, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.getDisplayCurrency({ organizationId });
    return resp.displayCurrency || 'USD';
});

export const setDisplayCurrency = createAsyncThunk<
    string,
    { currency: string },
    { state: RootState }
>('agentsGovernance/setDisplayCurrency', async ({ currency }, { getState }) => {
    const organizationId = requireOrg(getState);
    const resp = await agentsGovernanceApi.setDisplayCurrency({
        organizationId,
        displayCurrency: currency,
    });
    return resp.displayCurrency;
});

export interface UpsertUserQuotaArgs {
    userId: string;
    dailyLimit?: string | null;
    monthlyLimit?: string | null;
    dailyImageLimit?: number | null;
    monthlyImageLimit?: number | null;
    hardLimit: boolean;
    currency?: string;
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
        dailyLimit: args.dailyLimit ?? undefined,
        monthlyLimit: args.monthlyLimit ?? undefined,
        dailyImageLimit: args.dailyImageLimit ?? undefined,
        monthlyImageLimit: args.monthlyImageLimit ?? undefined,
        hardLimit: args.hardLimit,
        currency: args.currency ?? '',
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
