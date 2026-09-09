import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { skillEvaluationsApi } from "@/features/agents/api/skillEvaluationsApi";
import {
  evaluationCaseToPlain,
  evaluationRunToPlain,
  evaluationScopeToProto,
  evaluationTargetToProto,
  type EvaluationCaseInput,
  type EvaluationScopeInput,
  type EvaluationTargetInput,
} from "@/features/agents/store/agentSkillEvaluationsSerde";

export interface EvaluationRequestScope {
  organizationId: string;
  scope: EvaluationScopeInput;
}
export interface EvaluationRunRequest extends EvaluationRequestScope {
  agentId: string;
  requestId: string;
  target: EvaluationTargetInput;
  caseIds: string[];
  judge: boolean;
  modelOverride?: string;
  judgeModel?: string;
  singleCase?: boolean;
}

const createEvaluationThunk = createAsyncThunk.withTypes<{
  state: RootState;
  rejectValue: string;
}>();
const requireOrganization = (state: RootState, organizationId: string) => {
  if (!organizationId || state.auth.currentOrganizationId !== organizationId) {
    throw new Error("Organization changed");
  }
};
const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Evaluation request failed";

export const fetchEvaluationCases = createEvaluationThunk(
  "agentSkillEvaluations/cases",
  async (params: EvaluationRequestScope, { getState, rejectWithValue }) => {
    try {
      requireOrganization(getState(), params.organizationId);
      const response = await skillEvaluationsApi.listCases({
        organizationId: params.organizationId,
        scope: evaluationScopeToProto(params.scope),
      });
      return response.cases.map(evaluationCaseToPlain);
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);

export const saveEvaluationCase = createEvaluationThunk(
  "agentSkillEvaluations/saveCase",
  async (
    params: EvaluationRequestScope & { caseId?: string; fields: EvaluationCaseInput },
    { getState, rejectWithValue },
  ) => {
    try {
      requireOrganization(getState(), params.organizationId);
      const response = params.caseId
        ? await skillEvaluationsApi.updateCase({
            organizationId: params.organizationId,
            caseId: params.caseId,
            fields: params.fields,
          })
        : await skillEvaluationsApi.createCase({
            organizationId: params.organizationId,
            scope: evaluationScopeToProto(params.scope),
            fields: params.fields,
          });
      if (!response.evaluationCase) throw new Error("No evaluation case in response");
      return evaluationCaseToPlain(response.evaluationCase);
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);

export const deleteEvaluationCase = createEvaluationThunk(
  "agentSkillEvaluations/deleteCase",
  async (params: EvaluationRequestScope & { caseId: string }, { getState, rejectWithValue }) => {
    try {
      requireOrganization(getState(), params.organizationId);
      await skillEvaluationsApi.deleteCase({
        organizationId: params.organizationId,
        caseId: params.caseId,
      });
      return params.caseId;
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);

export const runSkillEvaluation = createEvaluationThunk(
  "agentSkillEvaluations/run",
  async (params: EvaluationRunRequest, { getState, rejectWithValue }) => {
    try {
      requireOrganization(getState(), params.organizationId);
      const request = {
        organizationId: params.organizationId,
        requestId: params.requestId,
        agentId: params.agentId,
        target: evaluationTargetToProto(params.target),
        caseIds: params.caseIds,
        judge: params.judge,
        modelOverride: params.modelOverride,
        judgeModel: params.judgeModel,
      };
      const response = params.singleCase
        ? await skillEvaluationsApi.runCase(request)
        : await skillEvaluationsApi.runSuite(request);
      return response.runs.map(evaluationRunToPlain);
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);

export const fetchEvaluationRuns = createEvaluationThunk(
  "agentSkillEvaluations/runs",
  async (
    params: EvaluationRequestScope & { agentId: string; cursor?: string },
    { getState, rejectWithValue },
  ) => {
    try {
      requireOrganization(getState(), params.organizationId);
      const response = await skillEvaluationsApi.listRuns({
        organizationId: params.organizationId,
        agentId: params.agentId,
        scope: evaluationScopeToProto(params.scope),
        pageSize: 50,
        cursor: params.cursor,
      });
      return { runs: response.runs.map(evaluationRunToPlain), nextCursor: response.nextCursor };
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);

export const fetchEvaluationRun = createEvaluationThunk(
  "agentSkillEvaluations/runStatus",
  async (
    params: EvaluationRequestScope & { agentId: string; runId: string },
    { getState, rejectWithValue },
  ) => {
    try {
      requireOrganization(getState(), params.organizationId);
      const response = await skillEvaluationsApi.getRun({
        organizationId: params.organizationId,
        runId: params.runId,
      });
      if (!response.run) throw new Error("No evaluation run in response");
      return evaluationRunToPlain(response.run);
    } catch (error) {
      return rejectWithValue(failure(error));
    }
  },
);
