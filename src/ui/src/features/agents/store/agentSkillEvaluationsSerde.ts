import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type {
  EvaluationCase,
  EvaluationCaseFields,
  EvaluationRun,
  EvaluationScopeSchema,
  EvaluationTargetSchema,
} from "@uniffy/proto/agents/v1/skill_evaluations_pb";

export type EvaluationScopeInput =
  | { skillId: string; draftId?: never }
  | { draftId: string; skillId?: never };
export type EvaluationTargetInput =
  | { skillVersionId: string; draftId?: never; draftContent?: never }
  | { draftId: string; draftContent?: string; skillVersionId?: never };

export const evaluationScopeKey = (scope: EvaluationScopeInput) =>
  scope.skillId !== undefined ? `skill:${scope.skillId}` : `draft:${scope.draftId}`;
export const evaluationScopeToProto = (
  scope: EvaluationScopeInput,
): MessageInitShape<typeof EvaluationScopeSchema> =>
  scope.skillId !== undefined
    ? { scope: { case: "skillId", value: scope.skillId } }
    : { scope: { case: "draftId", value: scope.draftId } };
export const evaluationTargetToProto = (
  target: EvaluationTargetInput,
): MessageInitShape<typeof EvaluationTargetSchema> =>
  target.skillVersionId !== undefined
    ? { target: { case: "skillVersionId", value: target.skillVersionId } }
    : {
        target: { case: "draftId", value: target.draftId },
        draftContent: target.draftContent,
      };

export const evaluationFieldsToPlain = (fields?: EvaluationCaseFields) => ({
  name: fields?.name ?? "",
  input: fields?.input ?? "",
  rubric: fields?.rubric ?? "",
  expectedTools: [...(fields?.expectedTools ?? [])],
  forbiddenTools: [...(fields?.forbiddenTools ?? [])],
  fixtures: (fields?.fixtures ?? []).map((fixture) => ({
    toolName: fixture.toolName,
    response: fixture.response,
    isError: fixture.isError,
  })),
});
export type EvaluationCaseInput = ReturnType<typeof evaluationFieldsToPlain>;

export const evaluationCaseToPlain = (value: EvaluationCase) => ({
  id: value.id,
  fields: evaluationFieldsToPlain(value.fields),
  createdAt: value.createdAt ? timestampDate(value.createdAt).toISOString() : "",
  updatedAt: value.updatedAt ? timestampDate(value.updatedAt).toISOString() : "",
});
export type SerializedEvaluationCase = ReturnType<typeof evaluationCaseToPlain>;

export const evaluationRunToPlain = (run: EvaluationRun) => ({
  id: run.id,
  requestId: run.requestId,
  caseId: run.caseId,
  agentId: run.agentId,
  skillId: run.skillId,
  skillVersionId: run.skillVersionId,
  versionNumber: run.versionNumber,
  draftId: run.draftId,
  targetDigest: run.targetDigest,
  status: run.status,
  error: run.error,
  caseSnapshot: evaluationFieldsToPlain(run.caseSnapshot),
  targetContent: run.targetContent,
  output: run.output,
  toolAttempts: run.toolAttempts.map((attempt) => ({
    toolName: attempt.toolName,
    inputJson: attempt.inputJson,
    fixtureResponse: attempt.fixtureResponse,
    fixtureUsed: attempt.fixtureUsed,
    issue: attempt.issue,
  })),
  assertions: run.assertions.map((assertion) => ({
    toolName: assertion.toolName,
    kind: assertion.kind,
    passed: assertion.passed,
  })),
  judge: {
    status: run.judge?.status ?? "not_requested",
    score: run.judge?.score,
    rationale: run.judge?.rationale ?? "",
    error: run.judge?.error ?? "",
  },
  model: run.model,
  cost: run.cost,
  costCurrency: run.costCurrency,
  inputTokens: run.inputTokens,
  outputTokens: run.outputTokens,
  durationMs: run.durationMs,
  createdAt: run.createdAt ? timestampDate(run.createdAt).toISOString() : "",
  completedAt: run.completedAt ? timestampDate(run.completedAt).toISOString() : undefined,
  ruleVersionIds: [...run.ruleVersionIds],
  outcomeReason: run.outcomeReason,
  runLogId: run.runLogId,
});
export type SerializedEvaluationRun = ReturnType<typeof evaluationRunToPlain>;
