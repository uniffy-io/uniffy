import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    BudgetsService,
    DeleteCurrencyRateRequestSchema,
    DeleteOrgBudgetRequestSchema,
    DeleteUserQuotaRequestSchema,
    GetCurrentSpendRequestSchema,
    GetDisplayCurrencyRequestSchema,
    GetOrgBudgetRequestSchema,
    GetUserQuotaRequestSchema,
    ListCurrencyRatesRequestSchema,
    ListUserQuotasRequestSchema,
    SetDisplayCurrencyRequestSchema,
    UpdateOrgBudgetRequestSchema,
    UpdateUserQuotaRequestSchema,
    UpsertCurrencyRateRequestSchema,
} from '@uniffy/proto/agents/v1/budgets_pb';
import {
    DeleteRateLimitRequestSchema,
    GetRateLimitsRequestSchema,
    RateLimitsService,
    UpsertRateLimitRequestSchema,
} from '@uniffy/proto/agents/v1/rate_limits_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const budgetsClient = createClient(BudgetsService, transport);
const rateLimitsClient = createClient(RateLimitsService, transport);

export const agentsGovernanceApi = {
    getOrgBudget: (req: MessageInitShape<typeof GetOrgBudgetRequestSchema>) =>
        budgetsClient.getOrgBudget(req),
    updateOrgBudget: (req: MessageInitShape<typeof UpdateOrgBudgetRequestSchema>) =>
        budgetsClient.updateOrgBudget(req),
    deleteOrgBudget: (req: MessageInitShape<typeof DeleteOrgBudgetRequestSchema>) =>
        budgetsClient.deleteOrgBudget(req),
    getUserQuota: (req: MessageInitShape<typeof GetUserQuotaRequestSchema>) =>
        budgetsClient.getUserQuota(req),
    updateUserQuota: (req: MessageInitShape<typeof UpdateUserQuotaRequestSchema>) =>
        budgetsClient.updateUserQuota(req),
    deleteUserQuota: (req: MessageInitShape<typeof DeleteUserQuotaRequestSchema>) =>
        budgetsClient.deleteUserQuota(req),
    listUserQuotas: (req: MessageInitShape<typeof ListUserQuotasRequestSchema>) =>
        budgetsClient.listUserQuotas(req),
    getCurrentSpend: (req: MessageInitShape<typeof GetCurrentSpendRequestSchema>) =>
        budgetsClient.getCurrentSpend(req),

    getRateLimits: (req: MessageInitShape<typeof GetRateLimitsRequestSchema>) =>
        rateLimitsClient.getRateLimits(req),
    upsertRateLimit: (req: MessageInitShape<typeof UpsertRateLimitRequestSchema>) =>
        rateLimitsClient.upsertRateLimit(req),
    deleteRateLimit: (req: MessageInitShape<typeof DeleteRateLimitRequestSchema>) =>
        rateLimitsClient.deleteRateLimit(req),

    listCurrencyRates: (req: MessageInitShape<typeof ListCurrencyRatesRequestSchema>) =>
        budgetsClient.listCurrencyRates(req),
    upsertCurrencyRate: (req: MessageInitShape<typeof UpsertCurrencyRateRequestSchema>) =>
        budgetsClient.upsertCurrencyRate(req),
    deleteCurrencyRate: (req: MessageInitShape<typeof DeleteCurrencyRateRequestSchema>) =>
        budgetsClient.deleteCurrencyRate(req),
    getDisplayCurrency: (req: MessageInitShape<typeof GetDisplayCurrencyRequestSchema>) =>
        budgetsClient.getDisplayCurrency(req),
    setDisplayCurrency: (req: MessageInitShape<typeof SetDisplayCurrencyRequestSchema>) =>
        budgetsClient.setDisplayCurrency(req),
};
