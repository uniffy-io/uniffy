/**
 * Redux slice for the agents governance admin surface.
 *
 * Holds the org budget row, current-period spend snapshot, the five
 * per-org rate-limit overrides, and per-tab loading / saving flags.
 * Thunks live alongside in agentsGovernanceThunks.ts.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
    fetchOrgBudget,
    updateOrgBudget,
    deleteOrgBudget,
    fetchCurrentSpend,
    fetchRateLimits,
    upsertRateLimit,
    deleteRateLimit,
} from './agentsGovernanceThunks';

export interface OrgBudgetState {
    id: string;
    monthlyLimitUsd: string | null;
    imageMonthlyLimit: number | null;
    hardLimit: boolean;
    alertThresholds: number[];
    resetDay: number;
}

export interface SpendState {
    spendUsd: string;
    imageCount: number;
    periodStart: string | null;
    periodEnd: string | null;
}

export interface RateLimitState {
    kind: number;
    limit: number;
    windowSeconds: number;
    isOverride: boolean;
}

interface AgentsGovernanceState {
    budget: OrgBudgetState | null;
    spend: SpendState | null;
    rateLimits: RateLimitState[];
    loadingBudget: boolean;
    savingBudget: boolean;
    loadingSpend: boolean;
    loadingRateLimits: boolean;
    savingRateLimit: boolean;
}

const initialState: AgentsGovernanceState = {
    budget: null,
    spend: null,
    rateLimits: [],
    loadingBudget: false,
    savingBudget: false,
    loadingSpend: false,
    loadingRateLimits: false,
    savingRateLimit: false,
};

const slice = createSlice({
    name: 'agentsGovernance',
    initialState,
    reducers: {
        clearAgentsGovernance: () => initialState,
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchOrgBudget.pending, (s) => {
                s.loadingBudget = true;
            })
            .addCase(fetchOrgBudget.fulfilled, (s, a: PayloadAction<OrgBudgetState | null>) => {
                s.loadingBudget = false;
                s.budget = a.payload;
            })
            .addCase(fetchOrgBudget.rejected, (s) => {
                s.loadingBudget = false;
            })
            .addCase(updateOrgBudget.pending, (s) => {
                s.savingBudget = true;
            })
            .addCase(updateOrgBudget.fulfilled, (s, a: PayloadAction<OrgBudgetState>) => {
                s.savingBudget = false;
                s.budget = a.payload;
            })
            .addCase(updateOrgBudget.rejected, (s) => {
                s.savingBudget = false;
            })
            .addCase(deleteOrgBudget.fulfilled, (s) => {
                s.budget = null;
            })
            .addCase(fetchCurrentSpend.pending, (s) => {
                s.loadingSpend = true;
            })
            .addCase(fetchCurrentSpend.fulfilled, (s, a: PayloadAction<SpendState>) => {
                s.loadingSpend = false;
                s.spend = a.payload;
            })
            .addCase(fetchCurrentSpend.rejected, (s) => {
                s.loadingSpend = false;
            })
            .addCase(fetchRateLimits.pending, (s) => {
                s.loadingRateLimits = true;
            })
            .addCase(fetchRateLimits.fulfilled, (s, a: PayloadAction<RateLimitState[]>) => {
                s.loadingRateLimits = false;
                s.rateLimits = a.payload;
            })
            .addCase(fetchRateLimits.rejected, (s) => {
                s.loadingRateLimits = false;
            })
            .addCase(upsertRateLimit.pending, (s) => {
                s.savingRateLimit = true;
            })
            .addCase(upsertRateLimit.fulfilled, (s, a: PayloadAction<RateLimitState>) => {
                s.savingRateLimit = false;
                const idx = s.rateLimits.findIndex((r) => r.kind === a.payload.kind);
                if (idx >= 0) {
                    s.rateLimits[idx] = a.payload;
                } else {
                    s.rateLimits.push(a.payload);
                }
            })
            .addCase(upsertRateLimit.rejected, (s) => {
                s.savingRateLimit = false;
            })
            .addCase(deleteRateLimit.fulfilled, (s, a: PayloadAction<number>) => {
                s.rateLimits = s.rateLimits.filter((r) => r.kind !== a.payload);
            });
    },
});

export const { clearAgentsGovernance } = slice.actions;
export const agentsGovernanceReducer = slice.reducer;
