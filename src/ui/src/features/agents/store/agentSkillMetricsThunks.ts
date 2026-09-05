import { createAsyncThunk } from "@reduxjs/toolkit";
import { skillsApi } from "@/features/agents/api/skillsApi";
import type { RootState } from "@/app/store";
import type { SkillMetric, SkillMetricCost } from "@uniffy/proto/agents/v1/skills_pb";

export const SKILL_METRICS_DEFAULT_WINDOW_DAYS = 30;
export const SKILL_METRICS_MAX_WINDOW_DAYS = 90;
export const SKILL_METRICS_PAGE_SIZE = 200;

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

/**
 * Redux state must stay serializable and a bigint is not. Observation counts,
 * token sums and millisecond totals sit far below 2^53, so the conversion is
 * exact for every value the reader can produce.
 */
export const int64ToNumber = (value: bigint | number): number => Number(value);

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: int64ToNumber(ts.seconds),
    nanos: int64ToNumber(ts.nanos),
  };
};

export const skillMetricCostToPlain = (cost: SkillMetricCost) => ({
  currency: cost.currency,
  // Decimal-as-string; never parsed into a float before display formatting.
  amount: cost.amount,
  runCount: int64ToNumber(cost.runCount),
});

export const skillMetricToPlain = (metric: SkillMetric) => ({
  skillId: metric.skillId,
  displayName: metric.displayName,
  skillVersionId: metric.skillVersionId,
  skillVersionNumber: metric.skillVersionNumber,
  invocationCount: int64ToNumber(metric.invocationCount),
  startedCount: int64ToNumber(metric.startedCount),
  completedCount: int64ToNumber(metric.completedCount),
  failedCount: int64ToNumber(metric.failedCount),
  rejectedCount: int64ToNumber(metric.rejectedCount),
  cancelledCount: int64ToNumber(metric.cancelledCount),
  toolErrorRunCount: int64ToNumber(metric.toolErrorRunCount),
  toolErrorRate: metric.toolErrorRate,
  uniqueUsers: int64ToNumber(metric.uniqueUsers),
  runLogCount: int64ToNumber(metric.runLogCount),
  durationMs: int64ToNumber(metric.durationMs),
  inputTokens: int64ToNumber(metric.inputTokens),
  outputTokens: int64ToNumber(metric.outputTokens),
  costs: metric.costs.map(skillMetricCostToPlain),
});

export type SerializedSkillMetric = ReturnType<typeof skillMetricToPlain>;
export type SerializedSkillMetricCost = ReturnType<typeof skillMetricCostToPlain>;

/** Rows are one exact immutable version, so the identity is the version, never the skill alone. */
export const skillMetricRowKey = (metric: { skillId: string; skillVersionId: string }): string =>
  `${metric.skillId}:${metric.skillVersionId}`;

export interface SkillMetricsScope {
  organizationId: string;
  /** Empty for org-wide reporting (org admins); a skill filter is open to builders. */
  skillId: string;
  windowDays: number;
}

export interface SkillMetricsRequest extends SkillMetricsScope {
  /** Empty for the first page; a later page carries the previous response's cursor. */
  cursor: string;
}

export interface SkillMetricsPage extends SkillMetricsRequest {
  metrics: SerializedSkillMetric[];
  nextCursor: string;
  windowStart?: { seconds: number; nanos: number };
  windowEnd?: { seconds: number; nanos: number };
}

export const fetchSkillMetrics = createAsyncThunk<
  SkillMetricsPage,
  SkillMetricsRequest,
  { state: RootState; rejectValue: string }
>("agentSkillMetrics/fetch", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    if (organizationId !== params.organizationId) throw new Error("Organization changed");
    const response = await skillsApi.getSkillMetrics({
      organizationId,
      skillId: params.skillId,
      windowDays: params.windowDays,
      pageSize: SKILL_METRICS_PAGE_SIZE,
      cursor: params.cursor,
    });
    return {
      ...params,
      metrics: response.metrics.map(skillMetricToPlain),
      nextCursor: response.nextCursor,
      windowStart: timestampToPlain(response.windowStart),
      windowEnd: timestampToPlain(response.windowEnd),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load skill metrics");
  }
});
