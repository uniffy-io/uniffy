import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
    fetchOrgBudget,
    updateOrgBudget,
    deleteOrgBudget,
    fetchCurrentSpend,
    fetchRateLimits,
    upsertRateLimit,
    deleteRateLimit,
    fetchCurrencyRates,
    upsertCurrencyRate,
    deleteCurrencyRate,
    fetchDisplayCurrency,
    setDisplayCurrency,
} from './agentsGovernanceThunks';

export interface OrgBudgetState {
    id: string;
    monthlyLimit: string | null;
    imageMonthlyLimit: number | null;
    hardLimit: boolean;
    alertThresholds: number[];
    resetDay: number;
    currency: string;
}

export interface SpendState {
    spend: string;
    currency: string;
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

export interface CurrencyRateState {
    fromCurrency: string;
    toCurrency: string;
    rate: string;
    updatedAt: string;
}

interface AgentsGovernanceState {
    budget: OrgBudgetState | null;
    spend: SpendState | null;
    rateLimits: RateLimitState[];
    currencyRates: CurrencyRateState[];
    displayCurrency: string;
    loadingBudget: boolean;
    savingBudget: boolean;
    loadingSpend: boolean;
    loadingRateLimits: boolean;
    savingRateLimit: boolean;
    loadingCurrencyRates: boolean;
    savingCurrencyRate: boolean;
    savingDisplayCurrency: boolean;
}

const initialState: AgentsGovernanceState = {
    budget: null,
    spend: null,
    rateLimits: [],
    currencyRates: [],
    displayCurrency: 'EUR',
    loadingBudget: false,
    savingBudget: false,
    loadingSpend: false,
    loadingRateLimits: false,
    savingRateLimit: false,
    loadingCurrencyRates: false,
    savingCurrencyRate: false,
    savingDisplayCurrency: false,
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
            })
            .addCase(fetchCurrencyRates.pending, (s) => {
                s.loadingCurrencyRates = true;
            })
            .addCase(fetchCurrencyRates.fulfilled, (s, a: PayloadAction<CurrencyRateState[]>) => {
                s.loadingCurrencyRates = false;
                s.currencyRates = a.payload;
            })
            .addCase(fetchCurrencyRates.rejected, (s) => {
                s.loadingCurrencyRates = false;
            })
            .addCase(upsertCurrencyRate.pending, (s) => {
                s.savingCurrencyRate = true;
            })
            .addCase(upsertCurrencyRate.fulfilled, (s, a: PayloadAction<CurrencyRateState>) => {
                s.savingCurrencyRate = false;
                const idx = s.currencyRates.findIndex(
                    (r) => r.fromCurrency === a.payload.fromCurrency && r.toCurrency === a.payload.toCurrency,
                );
                if (idx >= 0) {
                    s.currencyRates[idx] = a.payload;
                } else {
                    s.currencyRates.push(a.payload);
                }
            })
            .addCase(upsertCurrencyRate.rejected, (s) => {
                s.savingCurrencyRate = false;
            })
            .addCase(deleteCurrencyRate.fulfilled, (s, a: PayloadAction<{ from: string; to: string }>) => {
                s.currencyRates = s.currencyRates.filter(
                    (r) => !(r.fromCurrency === a.payload.from && r.toCurrency === a.payload.to),
                );
            })
            .addCase(fetchDisplayCurrency.fulfilled, (s, a: PayloadAction<string>) => {
                s.displayCurrency = a.payload;
            })
            .addCase(setDisplayCurrency.pending, (s) => {
                s.savingDisplayCurrency = true;
            })
            .addCase(setDisplayCurrency.fulfilled, (s, a: PayloadAction<string>) => {
                s.savingDisplayCurrency = false;
                s.displayCurrency = a.payload;
            })
            .addCase(setDisplayCurrency.rejected, (s) => {
                s.savingDisplayCurrency = false;
            });
    },
});

export const { clearAgentsGovernance } = slice.actions;
export const agentsGovernanceReducer = slice.reducer;
