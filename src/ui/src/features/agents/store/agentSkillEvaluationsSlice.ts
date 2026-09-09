import { createSlice, isAnyOf } from "@reduxjs/toolkit";
import { EvaluationStatus } from "@uniffy/proto/agents/v1/skill_evaluations_pb";
import type { RootState } from "@/app/store";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";
import {
  evaluationScopeKey,
  type EvaluationScopeInput,
  type SerializedEvaluationCase,
  type SerializedEvaluationRun,
} from "@/features/agents/store/agentSkillEvaluationsSerde";
import {
  deleteEvaluationCase,
  fetchEvaluationCases,
  fetchEvaluationRun,
  fetchEvaluationRuns,
  runSkillEvaluation,
  saveEvaluationCase,
  type EvaluationRequestScope,
} from "@/features/agents/store/agentSkillEvaluationsThunks";

interface EvaluationState {
  organizationId: string | null;
  userId: string | null;
  scopeKey: string | null;
  agentId: string | null;
  cases: SerializedEvaluationCase[];
  runs: SerializedEvaluationRun[];
  cursor: string;
  nextCursor: string;
  requests: Record<string, { id: string; agentId?: string }>;
  error: string | null;
}

const emptyData = () => ({
  scopeKey: null,
  agentId: null,
  cases: [],
  runs: [],
  cursor: "",
  nextCursor: "",
  requests: {},
  error: null,
});
const initialState: EvaluationState = {
  ...emptyData(),
  organizationId: null,
  userId: null,
};
type RequestArgs = EvaluationRequestScope & {
  agentId?: string;
  caseId?: string;
  runId?: string;
  requestId?: string;
};
const requestKey = (type: string, params: RequestArgs) =>
  `${type.slice(0, type.lastIndexOf("/"))}:${params.caseId ?? params.runId ?? params.requestId ?? ""}`;

export const evaluationIsOpen = (status: EvaluationStatus) =>
  status === EvaluationStatus.QUEUED || status === EvaluationStatus.RUNNING;

const retainSettled = (
  current: SerializedEvaluationRun | undefined,
  incoming: SerializedEvaluationRun,
) =>
  current &&
  ((!evaluationIsOpen(current.status) && evaluationIsOpen(incoming.status)) ||
    (current.status === EvaluationStatus.RUNNING && incoming.status === EvaluationStatus.QUEUED))
    ? current
    : incoming;

export const agentSkillEvaluationsSlice = createSlice({
  name: "agentSkillEvaluations",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logout, () => initialState)
      .addCase(rehydrateFailed, () => initialState)
      .addCase(setCredentials, (state, { payload }) => {
        const organizationId = payload.organizationId || null;
        const userId = payload.user.id;
        if (organizationId !== state.organizationId || userId !== state.userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addCase(rehydrateComplete, (state, { payload }) => {
        const organizationId = payload.organizationId || state.organizationId;
        const userId = payload.user.id;
        if (organizationId !== state.organizationId || userId !== state.userId) {
          return { ...initialState, organizationId, userId };
        }
      })
      .addMatcher(
        isAnyOf(
          fetchEvaluationCases.pending,
          saveEvaluationCase.pending,
          deleteEvaluationCase.pending,
          fetchEvaluationRuns.pending,
          fetchEvaluationRun.pending,
          runSkillEvaluation.pending,
        ),
        (state, action) => {
          const params: RequestArgs = action.meta.arg;
          if (params.organizationId !== state.organizationId) return;
          const scopeKey = evaluationScopeKey(params.scope);
          if (fetchEvaluationCases.pending.match(action) && state.scopeKey !== scopeKey) {
            Object.assign(state, emptyData(), { scopeKey });
          }
          if (scopeKey !== state.scopeKey) return;
          if (fetchEvaluationRuns.pending.match(action)) {
            if (state.agentId !== params.agentId) {
              state.agentId = params.agentId ?? null;
              state.runs = [];
              for (const [key, request] of Object.entries(state.requests)) {
                if (request.agentId) delete state.requests[key];
              }
            }
            const cursor = action.meta.arg.cursor ?? "";
            if (state.cursor !== cursor) state.runs = [];
            state.cursor = cursor;
          }
          if (params.agentId && params.agentId !== state.agentId) return;
          if (
            saveEvaluationCase.pending.match(action) ||
            deleteEvaluationCase.pending.match(action)
          ) {
            delete state.requests[`${fetchEvaluationCases.typePrefix}:`];
          }
          if (runSkillEvaluation.pending.match(action)) {
            delete state.requests[`${fetchEvaluationRuns.typePrefix}:`];
          }
          state.requests[requestKey(action.type, params)] = {
            id: action.meta.requestId,
            agentId: params.agentId,
          };
          state.error = null;
        },
      )
      .addMatcher(
        isAnyOf(
          fetchEvaluationCases.fulfilled,
          saveEvaluationCase.fulfilled,
          deleteEvaluationCase.fulfilled,
          fetchEvaluationRuns.fulfilled,
          fetchEvaluationRun.fulfilled,
          runSkillEvaluation.fulfilled,
        ),
        (state, action) => {
          const key = requestKey(action.type, action.meta.arg);
          if (state.requests[key]?.id !== action.meta.requestId) return;
          delete state.requests[key];
          if (fetchEvaluationCases.fulfilled.match(action)) state.cases = action.payload;
          if (saveEvaluationCase.fulfilled.match(action)) {
            const index = state.cases.findIndex((item) => item.id === action.payload.id);
            if (index < 0) state.cases.push(action.payload);
            else state.cases[index] = action.payload;
          }
          if (deleteEvaluationCase.fulfilled.match(action)) {
            state.cases = state.cases.filter((item) => item.id !== action.payload);
          }
          if (fetchEvaluationRuns.fulfilled.match(action)) {
            state.runs = action.payload.runs.map((run) =>
              retainSettled(
                state.runs.find((item) => item.id === run.id),
                run,
              ),
            );
            state.nextCursor = action.payload.nextCursor;
          }
          if (
            fetchEvaluationRun.fulfilled.match(action) ||
            runSkillEvaluation.fulfilled.match(action)
          ) {
            const runs = Array.isArray(action.payload) ? action.payload : [action.payload];
            for (const run of runs) {
              const index = state.runs.findIndex((item) => item.id === run.id);
              if (index < 0) state.runs.unshift(run);
              else state.runs[index] = retainSettled(state.runs[index], run);
            }
            state.runs = state.runs.slice(0, 50);
          }
        },
      )
      .addMatcher(
        isAnyOf(
          fetchEvaluationCases.rejected,
          saveEvaluationCase.rejected,
          deleteEvaluationCase.rejected,
          fetchEvaluationRuns.rejected,
          fetchEvaluationRun.rejected,
          runSkillEvaluation.rejected,
        ),
        (state, action) => {
          const key = requestKey(action.type, action.meta.arg);
          if (state.requests[key]?.id !== action.meta.requestId) return;
          delete state.requests[key];
          state.error = action.payload ?? "Evaluation request failed";
          if (fetchEvaluationCases.rejected.match(action)) state.cases = [];
          if (fetchEvaluationRuns.rejected.match(action)) state.runs = [];
          if (fetchEvaluationRun.rejected.match(action)) {
            state.runs = state.runs.filter((run) => run.id !== action.meta.arg.runId);
          }
        },
      );
  },
});

const EMPTY_CASES: SerializedEvaluationCase[] = [];
const EMPTY_RUNS: SerializedEvaluationRun[] = [];
export const selectEvaluationCases = (scope: EvaluationScopeInput) => (state: RootState) =>
  state.agentSkillEvaluations.scopeKey === evaluationScopeKey(scope)
    ? state.agentSkillEvaluations.cases
    : EMPTY_CASES;
export const selectEvaluationRuns =
  (scope: EvaluationScopeInput, agentId: string) => (state: RootState) =>
    state.agentSkillEvaluations.scopeKey === evaluationScopeKey(scope) &&
    state.agentSkillEvaluations.agentId === agentId
      ? state.agentSkillEvaluations.runs
      : EMPTY_RUNS;
export const agentSkillEvaluationsReducer = agentSkillEvaluationsSlice.reducer;
