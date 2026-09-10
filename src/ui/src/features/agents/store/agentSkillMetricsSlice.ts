import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";
import {
  fetchSkillMetrics,
  skillMetricRowKey,
  type SerializedSkillMetric,
  type SkillMetricsScope,
} from "@/features/agents/store/agentSkillMetricsThunks";

export type SkillMetricsStatus = "loading" | "loading-more" | "ready" | "failed";

export interface SkillMetricsEntry {
  rows: SerializedSkillMetric[];
  nextCursor: string;
  windowStart?: { seconds: number; nanos: number };
  windowEnd?: { seconds: number; nanos: number };
  status: SkillMetricsStatus;
  error?: string;
}

interface AgentSkillMetricsState {
  organizationId: string | null;
  entries: Record<string, SkillMetricsEntry>;
  requests: Record<string, string>;
}

const initialState: AgentSkillMetricsState = {
  organizationId: null,
  entries: {},
  requests: {},
};

/** One entry per reporting scope and window; a cursor walks pages inside it. */
const scopeKey = ({ skillId, windowDays }: Pick<SkillMetricsScope, "skillId" | "windowDays">) =>
  `${skillId || "org"}:${windowDays}`;

function ensureEntry(state: AgentSkillMetricsState, key: string): SkillMetricsEntry {
  let entry = state.entries[key];
  if (!entry) {
    entry = { rows: [], nextCursor: "", status: "loading" };
    state.entries[key] = entry;
  }
  return entry;
}

export const agentSkillMetricsSlice = createSlice({
  name: "agentSkillMetrics",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logout, () => initialState)
      .addCase(rehydrateFailed, () => initialState)
      .addCase(setCredentials, (state, { payload }) => {
        const organizationId = payload.organizationId || null;
        if (organizationId !== state.organizationId) {
          return { ...initialState, organizationId };
        }
      })
      .addCase(rehydrateComplete, (state, { payload }) => {
        if (payload.organizationId && payload.organizationId !== state.organizationId) {
          return { ...initialState, organizationId: payload.organizationId };
        }
      })
      .addCase(fetchSkillMetrics.pending, (state, { meta }) => {
        if (state.organizationId !== meta.arg.organizationId) return;
        const key = scopeKey(meta.arg);
        const entry = ensureEntry(state, key);
        state.requests[key] = meta.requestId;
        entry.status = meta.arg.cursor ? "loading-more" : "loading";
        delete entry.error;
      })
      .addCase(fetchSkillMetrics.fulfilled, (state, { payload, meta }) => {
        const key = scopeKey(payload);
        if (state.requests[key] !== meta.requestId) return;
        const entry = ensureEntry(state, key);
        if (payload.cursor) {
          const seen = new Set(entry.rows.map(skillMetricRowKey));
          entry.rows.push(...payload.metrics.filter((row) => !seen.has(skillMetricRowKey(row))));
        } else {
          entry.rows = payload.metrics;
          entry.windowStart = payload.windowStart;
          entry.windowEnd = payload.windowEnd;
        }
        entry.nextCursor = payload.nextCursor;
        entry.status = "ready";
        delete entry.error;
        delete state.requests[key];
      })
      .addCase(fetchSkillMetrics.rejected, (state, { payload, meta }) => {
        const key = scopeKey(meta.arg);
        if (state.requests[key] !== meta.requestId) return;
        const entry = ensureEntry(state, key);
        entry.status = "failed";
        entry.error = payload ?? "Failed to load skill metrics";
        delete state.requests[key];
      });
  },
});

export const selectSkillMetricsEntry =
  (scope: Pick<SkillMetricsScope, "skillId" | "windowDays">) =>
  (state: RootState): SkillMetricsEntry | undefined =>
    state.auth.currentOrganizationId &&
    state.auth.currentOrganizationId === state.agentSkillMetrics.organizationId
      ? state.agentSkillMetrics.entries[scopeKey(scope)]
      : undefined;

export const agentSkillMetricsReducer = agentSkillMetricsSlice.reducer;
