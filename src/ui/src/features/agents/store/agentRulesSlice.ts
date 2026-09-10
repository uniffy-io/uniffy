import { createSlice, isAnyOf, isPending, isFulfilled, isRejected } from "@reduxjs/toolkit";
import { logout } from "@/features/auth/store/authSlice";
import {
  fetchRules,
  fetchRule,
  saveRule,
  changeRuleVersion,
  changeRuleStatus,
  fetchRuleVersions,
  fetchEnabledRules,
  setEnabledRules,
  type SerializedRule,
  type SerializedRuleVersion,
} from "@/features/agents/store/agentRulesThunks";

interface RulesState {
  requests: Record<string, true>;
  rules: Record<string, SerializedRule>;
  details: Record<string, SerializedRule>;
  detailStatus: Record<string, "loading" | "loaded" | "failed">;
  versions: Record<string, { items: SerializedRuleVersion[]; nextPageToken: string }>;
  versionsLoading: Record<string, boolean>;
  selections: Record<string, string[]>;
  selecting: Record<string, boolean>;
  selectionErrors: Record<string, boolean>;
  loading: boolean;
  nextPageToken: string;
}
const initialState: RulesState = {
  requests: {},
  rules: {},
  details: {},
  detailStatus: {},
  versions: {},
  versionsLoading: {},
  selections: {},
  selecting: {},
  selectionErrors: {},
  loading: false,
  nextPageToken: "",
};
const ruleRequests = [
  fetchRules,
  fetchRule,
  saveRule,
  changeRuleVersion,
  changeRuleStatus,
  fetchRuleVersions,
  fetchEnabledRules,
  setEnabledRules,
] as const;
const slice = createSlice({
  name: "agentRules",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logout, () => initialState)
      .addCase(fetchRule.pending, (state, { meta }) => {
        state.detailStatus[meta.arg] = "loading";
      })
      .addCase(fetchRule.rejected, (state, { meta }) => {
        state.detailStatus[meta.arg] = "failed";
      })
      .addCase(fetchRules.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchRules.rejected, (state) => {
        state.loading = false;
      })
      .addCase(fetchRules.fulfilled, (state, { payload, meta }) => {
        if (!state.requests[meta.requestId]) return;
        state.loading = false;
        if (!payload.append) state.rules = {};
        for (const rule of payload.rules) state.rules[rule.id] = rule;
        state.nextPageToken = payload.nextPageToken;
      })
      .addCase(fetchRuleVersions.pending, (state, { meta }) => {
        state.versionsLoading[meta.arg.ruleId] = true;
      })
      .addCase(fetchRuleVersions.rejected, (state, { meta }) => {
        state.versionsLoading[meta.arg.ruleId] = false;
      })
      .addCase(fetchRuleVersions.fulfilled, (state, { payload, meta }) => {
        state.versionsLoading[payload.ruleId] = false;
        if (!state.requests[meta.requestId]) return;
        const existing = payload.append ? (state.versions[payload.ruleId]?.items ?? []) : [];
        state.versions[payload.ruleId] = {
          items: [...existing, ...payload.versions],
          nextPageToken: payload.nextPageToken,
        };
      })
      .addCase(setEnabledRules.pending, (state, { meta }) => {
        state.selecting[meta.arg.agentId] = true;
      })
      .addCase(fetchEnabledRules.pending, (state, { meta }) => {
        state.selecting[meta.arg] = true;
        state.selectionErrors[meta.arg] = false;
      })
      .addCase(fetchEnabledRules.rejected, (state, { meta }) => {
        if (!state.requests[meta.requestId]) return;
        state.selecting[meta.arg] = false;
        state.selectionErrors[meta.arg] = true;
      })
      .addCase(setEnabledRules.rejected, (state, { meta }) => {
        state.selecting[meta.arg.agentId] = false;
      })
      .addMatcher(
        isAnyOf(
          fetchRule.fulfilled,
          saveRule.fulfilled,
          changeRuleVersion.fulfilled,
          changeRuleStatus.fulfilled,
        ),
        (state, { payload, meta }) => {
          if (!state.requests[meta.requestId]) return;
          state.rules[payload.id] = payload;
          state.details[payload.id] = payload;
          state.detailStatus[payload.id] = "loaded";
        },
      )
      .addMatcher(
        isAnyOf(fetchEnabledRules.fulfilled, setEnabledRules.fulfilled),
        (state, { payload, meta }) => {
          if (!state.requests[meta.requestId]) return;
          state.selections[payload.target] = payload.ruleIds;
          state.selecting[payload.target] = false;
        },
      )
      .addMatcher(isPending(...ruleRequests), (state, { meta }) => {
        state.requests[meta.requestId] = true;
      })
      .addMatcher(
        isAnyOf(isFulfilled(...ruleRequests), isRejected(...ruleRequests)),
        (state, { meta }) => {
          delete state.requests[meta.requestId];
        },
      );
  },
});
export const agentRulesReducer = slice.reducer;
