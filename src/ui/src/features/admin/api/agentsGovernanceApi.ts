/**
 * Admin API for the agents governance surface.
 *
 * Wraps the three agents.v1 ConnectRPC services that drive the
 * /admin/agents-budgets page: budgets + per-user quotas, per-org
 * rate-limit overrides, model pricing.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { BudgetsService } from '@uniffy/proto/agents/v1/budgets_connect';
import { PricingService } from '@uniffy/proto/agents/v1/pricing_connect';
import { RateLimitsService } from '@uniffy/proto/agents/v1/rate_limits_connect';
import type {
    GetOrgBudgetRequest,
    UpdateOrgBudgetRequest,
    DeleteOrgBudgetRequest,
    GetUserQuotaRequest,
    UpdateUserQuotaRequest,
    DeleteUserQuotaRequest,
    ListUserQuotasRequest,
    GetCurrentSpendRequest,
    ListCurrencyRatesRequest,
    UpsertCurrencyRateRequest,
    DeleteCurrencyRateRequest,
    GetDisplayCurrencyRequest,
    SetDisplayCurrencyRequest,
} from '@uniffy/proto/agents/v1/budgets_pb';
import type {
    ListModelPricingRequest,
    UpsertModelPricingRequest,
    DeleteModelPricingRequest,
} from '@uniffy/proto/agents/v1/pricing_pb';
import type {
    GetRateLimitsRequest,
    UpsertRateLimitRequest,
    DeleteRateLimitRequest,
} from '@uniffy/proto/agents/v1/rate_limits_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

const budgetsClient = createClient(BudgetsService, transport);
const pricingClient = createClient(PricingService, transport);
const rateLimitsClient = createClient(RateLimitsService, transport);

export const agentsGovernanceApi = {
    // Budgets / quotas
    getOrgBudget: (req: PartialMessage<GetOrgBudgetRequest>) =>
        budgetsClient.getOrgBudget(req),
    updateOrgBudget: (req: PartialMessage<UpdateOrgBudgetRequest>) =>
        budgetsClient.updateOrgBudget(req),
    deleteOrgBudget: (req: PartialMessage<DeleteOrgBudgetRequest>) =>
        budgetsClient.deleteOrgBudget(req),
    getUserQuota: (req: PartialMessage<GetUserQuotaRequest>) =>
        budgetsClient.getUserQuota(req),
    updateUserQuota: (req: PartialMessage<UpdateUserQuotaRequest>) =>
        budgetsClient.updateUserQuota(req),
    deleteUserQuota: (req: PartialMessage<DeleteUserQuotaRequest>) =>
        budgetsClient.deleteUserQuota(req),
    listUserQuotas: (req: PartialMessage<ListUserQuotasRequest>) =>
        budgetsClient.listUserQuotas(req),
    getCurrentSpend: (req: PartialMessage<GetCurrentSpendRequest>) =>
        budgetsClient.getCurrentSpend(req),

    // Pricing
    listModelPricing: (req: PartialMessage<ListModelPricingRequest>) =>
        pricingClient.listModelPricing(req),
    upsertModelPricing: (req: PartialMessage<UpsertModelPricingRequest>) =>
        pricingClient.upsertModelPricing(req),
    deleteModelPricing: (req: PartialMessage<DeleteModelPricingRequest>) =>
        pricingClient.deleteModelPricing(req),

    // Rate limits
    getRateLimits: (req: PartialMessage<GetRateLimitsRequest>) =>
        rateLimitsClient.getRateLimits(req),
    upsertRateLimit: (req: PartialMessage<UpsertRateLimitRequest>) =>
        rateLimitsClient.upsertRateLimit(req),
    deleteRateLimit: (req: PartialMessage<DeleteRateLimitRequest>) =>
        rateLimitsClient.deleteRateLimit(req),

    // Currencies
    listCurrencyRates: (req: PartialMessage<ListCurrencyRatesRequest>) =>
        budgetsClient.listCurrencyRates(req),
    upsertCurrencyRate: (req: PartialMessage<UpsertCurrencyRateRequest>) =>
        budgetsClient.upsertCurrencyRate(req),
    deleteCurrencyRate: (req: PartialMessage<DeleteCurrencyRateRequest>) =>
        budgetsClient.deleteCurrencyRate(req),
    getDisplayCurrency: (req: PartialMessage<GetDisplayCurrencyRequest>) =>
        budgetsClient.getDisplayCurrency(req),
    setDisplayCurrency: (req: PartialMessage<SetDisplayCurrencyRequest>) =>
        budgetsClient.setDisplayCurrency(req),
};
