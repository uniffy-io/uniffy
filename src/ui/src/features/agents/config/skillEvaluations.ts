import { EvaluationStatus } from "@uniffy/proto/agents/v1/skill_evaluations_pb";

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  [EvaluationStatus.UNSPECIFIED]: "Unknown",
  [EvaluationStatus.QUEUED]: "Queued",
  [EvaluationStatus.RUNNING]: "Running",
  [EvaluationStatus.PASSED]: "Passed",
  [EvaluationStatus.FAILED]: "Failed",
  [EvaluationStatus.INCONCLUSIVE]: "Inconclusive",
  [EvaluationStatus.ERROR]: "Could not finish",
};

const OUTCOME_REASONS: Record<string, string> = {
  forbidden_tool: "The agent attempted a forbidden tool.",
  unavailable_tool: "The agent attempted a tool unavailable to this agent.",
  missing_fixture: "A tool call has no sample response. Add one to make this case conclusive.",
  tool_limit: "The agent reached the tool-call limit before completing the response.",
  no_assertions: "Add expected or forbidden tools to obtain a deterministic result.",
  missing_expected_tool: "The agent did not call every expected tool.",
  incomplete_output: "The model did not finish its response within the evaluation limits.",
};
export const evaluationOutcomeReason = (reason: string) => OUTCOME_REASONS[reason] ?? "";
