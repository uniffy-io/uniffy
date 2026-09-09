import { Fragment, useState } from "react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { EvaluationStatus } from "@uniffy/proto/agents/v1/skill_evaluations_pb";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { friendlyErrorMessage } from "@/config/errorMessages";
import {
  EVALUATION_STATUS_LABELS,
  evaluationOutcomeReason,
} from "@/features/agents/config/skillEvaluations";
import { toolActionLabel } from "@/features/agents/config/toolLabels";
import type { SerializedEvaluationRun } from "@/features/agents/store/agentSkillEvaluationsSerde";
import { formatCurrency } from "@/shared/utils/currencyFormatting";
import { formatSmartDateTime } from "@/shared/utils/dateFormatting";

function EvaluationStatusBadge({ run }: { run: SerializedEvaluationRun }) {
  const color =
    run.status === EvaluationStatus.PASSED
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : run.status === EvaluationStatus.FAILED || run.status === EvaluationStatus.ERROR
        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
        : undefined;
  return (
    <Badge variant="secondary" className={color}>
      {EVALUATION_STATUS_LABELS[run.status]}
    </Badge>
  );
}

function RunFacts({ run }: { run: SerializedEvaluationRun }) {
  return (
    <p className="text-xs text-muted-foreground">
      {run.model || "Model pending"} · {formatSmartDateTime(run.createdAt)} ·{" "}
      {run.cost && run.costCurrency ? formatCurrency(run.cost, run.costCurrency) : "Cost pending"}
      {run.completedAt && <> · {(run.durationMs / 1000).toFixed(1)}s</>}
    </p>
  );
}

function EvaluationMarkdown({ value }: { value: string }) {
  return (
    <CrepeEditor
      contentType={ContentType.AGENT}
      contentId=""
      value={value}
      readonly
      enableUpload={false}
      allowImages={false}
      autoEmbedMedia={false}
      compact
      minHeight="0px"
    />
  );
}

function RunDetail({ run }: { run: SerializedEvaluationRun }) {
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  return (
    <div className="space-y-4 p-2">
      <RunFacts run={run} />
      {run.error && (
        <p className="text-sm text-muted-foreground">
          {friendlyErrorMessage("skill_evaluation_" + run.error)}
        </p>
      )}
      {run.outcomeReason && (
        <p className="text-sm text-muted-foreground">
          {evaluationOutcomeReason(run.outcomeReason)}
        </p>
      )}
      {run.assertions.length > 0 && (
        <ul className="space-y-1 text-sm">
          {run.assertions.map((assertion, index) => (
            <li key={index}>
              {assertion.passed ? "Passed" : "Failed"}: {toolActionLabel(assertion.toolName)}{" "}
              {assertion.kind === "expected" ? "must be called" : "must not be called"}
            </li>
          ))}
        </ul>
      )}
      {run.toolAttempts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Observed tool calls</p>
          {run.toolAttempts.map((attempt, index) => (
            <details key={index} className="rounded-lg bg-muted/50 p-3">
              <summary className="cursor-pointer text-sm">
                {toolActionLabel(attempt.toolName)} ·{" "}
                {attempt.fixtureUsed ? "Sample returned" : "No sample returned"}
              </summary>
              {attempt.issue && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {evaluationOutcomeReason(attempt.issue)}
                </p>
              )}
              <p className="mt-3 text-xs font-medium">Arguments</p>
              <pre className="mt-1 whitespace-pre-wrap break-all text-xs">{attempt.inputJson}</pre>
              {attempt.fixtureUsed && (
                <>
                  <p className="mt-3 text-xs font-medium">Sample response</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                    {attempt.fixtureResponse || "(empty)"}
                  </pre>
                </>
              )}
            </details>
          ))}
        </div>
      )}
      {run.output && (
        <div>
          <p className="mb-2 text-sm font-medium">Response</p>
          <EvaluationMarkdown value={run.output} />
        </div>
      )}
      {run.judge.status === "completed" && (
        <div>
          <p className="text-sm font-medium">
            Rubric score: {((run.judge.score ?? 0) * 100).toFixed(0)}%
          </p>
          <EvaluationMarkdown value={run.judge.rationale} />
        </div>
      )}
      {run.judge.status === "error" && (
        <p className="text-sm text-muted-foreground">
          {friendlyErrorMessage("skill_evaluation_judge_" + run.judge.error)}
        </p>
      )}
      <Button
        className="min-h-11"
        variant="ghost"
        onClick={() => setSnapshotOpen((open) => !open)}
        aria-expanded={snapshotOpen}
      >
        {snapshotOpen
          ? "Hide evaluated instructions and case"
          : "Show evaluated instructions and case"}
      </Button>
      {snapshotOpen && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Snapshot {run.targetDigest} · {run.ruleVersionIds.length} selected rules ·{" "}
            {run.inputTokens} input / {run.outputTokens} output tokens
          </p>
          <p className="text-sm font-medium">Skill instructions</p>
          <EvaluationMarkdown value={run.targetContent} />
          <p className="text-sm font-medium">Case input</p>
          <EvaluationMarkdown value={run.caseSnapshot.input} />
          {run.caseSnapshot.rubric && (
            <>
              <p className="text-sm font-medium">Rubric</p>
              <EvaluationMarkdown value={run.caseSnapshot.rubric} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SkillEvaluationResults({ runs }: { runs: SerializedEvaluationRun[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (runs.length === 0)
    return <p className="text-sm text-muted-foreground">No evaluations yet for this agent.</p>;
  return (
    <Table tone="card">
      <TableHeader>
        <TableRow>
          <TableHead>Case / target</TableHead>
          <TableHead>Result</TableHead>
          <TableHead className="hidden md:table-cell">Model / cost / time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <Fragment key={run.id}>
            <TableRow>
              <TableCell>
                <button
                  className="min-h-11 text-left focus-ring rounded"
                  aria-expanded={expandedId === run.id}
                  onClick={() => setExpandedId((id) => (id === run.id ? null : run.id))}
                >
                  <span className="block text-sm font-medium">{run.caseSnapshot.name}</span>
                  <span className="text-xs text-muted-foreground" title={run.targetDigest}>
                    {run.draftId
                      ? `Draft · ${run.targetDigest.slice(0, 8)}`
                      : `Version ${run.versionNumber}`}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <EvaluationStatusBadge run={run} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <RunFacts run={run} />
              </TableCell>
            </TableRow>
            {expandedId === run.id && (
              <TableRow>
                <TableCell colSpan={3}>
                  <RunDetail run={run} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function SkillEvaluationComparison({
  runs,
  requestIds,
}: {
  runs: SerializedEvaluationRun[];
  requestIds: [string, string];
}) {
  const active = runs.filter((run) => run.requestId === requestIds[0]);
  const draft = runs.filter((run) => run.requestId === requestIds[1]);
  const caseIds = [...new Set([...active, ...draft].map((run) => run.caseId))];
  if (caseIds.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="skill-evaluation-comparison">
      <p className="text-sm font-medium">Active version and draft</p>
      <p className="text-xs text-muted-foreground">
        Each run captures its case and agent configuration at request time. Results inform your
        review; saving the draft is a separate action.
      </p>
      {caseIds.map((caseId) => {
        const pair = [
          active.find((run) => run.caseId === caseId),
          draft.find((run) => run.caseId === caseId),
        ];
        const changedCase =
          pair[0] &&
          pair[1] &&
          JSON.stringify(pair[0].caseSnapshot) !== JSON.stringify(pair[1].caseSnapshot);
        return (
          <Card key={caseId} className="space-y-3 p-4">
            <p className="text-sm font-medium">
              {pair[0]?.caseSnapshot.name ?? pair[1]?.caseSnapshot.name}
            </p>
            {changedCase && (
              <p className="text-xs text-muted-foreground">
                This case changed between requests. Open the results to review the captured inputs.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {pair.map((run, index) => (
                <div key={index} className="min-w-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {index === 0
                      ? `Active version${run ? ` ${run.versionNumber}` : ""}`
                      : `Draft${run ? ` · ${run.targetDigest.slice(0, 8)}` : ""}`}
                  </p>
                  {run ? (
                    <>
                      <EvaluationStatusBadge run={run} />
                      <RunFacts run={run} />
                      {run.judge.status === "completed" && (
                        <p className="text-xs">
                          Rubric: {((run.judge.score ?? 0) * 100).toFixed(0)}%
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Awaiting request</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
