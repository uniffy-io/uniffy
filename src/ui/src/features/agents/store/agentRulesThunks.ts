import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RuleInfo, RuleVersion } from "@uniffy/proto/agents/v1/rules_pb";
import type { RootState } from "@/app/store";
import { rulesApi } from "@/features/agents/api/rulesApi";

const thunk = createAsyncThunk.withTypes<{ state: RootState }>();
const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};
const organization = (state: RootState) => {
  if (!state.auth.currentOrganizationId) throw new Error("No organization selected");
  return state.auth.currentOrganizationId;
};

export const ruleToPlain = (rule: RuleInfo) => ({
  id: rule.id,
  name: rule.name,
  displayName: rule.displayName,
  description: rule.description,
  content: rule.content,
  source: rule.source,
  status: rule.status,
  latestVersionNumber: rule.latestVersionNumber,
  activeVersionId: rule.activeVersionId,
  activeVersionPinned: rule.activeVersionPinned,
});
export type SerializedRule = ReturnType<typeof ruleToPlain>;
export const ruleVersionToPlain = (version: RuleVersion) => ({
  id: version.id,
  versionNumber: version.versionNumber,
  displayName: version.displayName,
  description: version.description,
  content: version.content,
  changeSummary: version.changeSummary,
  createdAt: timestampToPlain(version.createdAt),
});
export type SerializedRuleVersion = ReturnType<typeof ruleVersionToPlain>;
export interface RuleFields {
  name: string;
  displayName: string;
  description: string;
  content: string;
}

export const fetchRules = thunk(
  "agentRules/fetch",
  async (pageToken: string | undefined, { getState }) => {
    const response = await rulesApi.listRules({
      organizationId: organization(getState()),
      pageToken,
      includeRetired: true,
    });
    return {
      rules: response.rules.map(ruleToPlain),
      nextPageToken: response.nextPageToken,
      append: !!pageToken,
    };
  },
);
export const fetchRule = thunk("agentRules/get", async (ruleId: string, { getState }) => {
  const response = await rulesApi.getRule({ organizationId: organization(getState()), ruleId });
  if (!response.rule) throw new Error("Rule not found");
  return ruleToPlain(response.rule);
});
export const saveRule = thunk(
  "agentRules/save",
  async (params: RuleFields & { ruleId?: string }, { getState }) => {
    const request = { ...params, organizationId: organization(getState()) };
    const response = params.ruleId
      ? await rulesApi.updateRule(request)
      : await rulesApi.createRule(request);
    if (!response.rule) throw new Error("Rule not found");
    return ruleToPlain(response.rule);
  },
);
export const changeRuleVersion = thunk(
  "agentRules/changeVersion",
  async (
    params: { ruleId: string; versionNumber: number; action: "pin" | "follow" | "revert" },
    { getState },
  ) => {
    const request = {
      ...params,
      organizationId: organization(getState()),
      followLatest: params.action === "follow",
    };
    const response =
      params.action === "revert"
        ? await rulesApi.revertRule(request)
        : await rulesApi.setMainRuleVersion(request);
    if (!response.rule) throw new Error("Rule not found");
    return ruleToPlain(response.rule);
  },
);
export const changeRuleStatus = thunk(
  "agentRules/changeStatus",
  async (params: { ruleId: string; retired: boolean }, { getState }) => {
    const request = { organizationId: organization(getState()), ruleId: params.ruleId };
    const response = params.retired
      ? await rulesApi.retireRule(request)
      : await rulesApi.restoreRule(request);
    if (!response.rule) throw new Error("Rule not found");
    return ruleToPlain(response.rule);
  },
);
export const fetchRuleVersions = thunk(
  "agentRules/versions",
  async (params: { ruleId: string; pageToken?: string }, { getState }) => {
    const response = await rulesApi.listRuleVersions({
      ...params,
      organizationId: organization(getState()),
    });
    return {
      ruleId: params.ruleId,
      versions: response.versions.map(ruleVersionToPlain),
      nextPageToken: response.nextPageToken,
      append: !!params.pageToken,
    };
  },
);
export const fetchEnabledRules = thunk(
  "agentRules/getEnabled",
  async (agentId: string, { getState }) => {
    const response = await rulesApi.getEnabledRules({
      organizationId: organization(getState()),
      agentId,
    });
    return { target: agentId, ruleIds: [...response.ruleIds] };
  },
);
export const setEnabledRules = thunk(
  "agentRules/setEnabled",
  async (params: { agentId: string; ruleIds: string[] }, { getState }) => {
    const response = await rulesApi.setEnabledRules({
      ...params,
      organizationId: organization(getState()),
    });
    return { target: params.agentId, ruleIds: [...response.ruleIds] };
  },
);
