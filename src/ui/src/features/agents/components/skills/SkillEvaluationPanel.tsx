import { useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { EvaluationCaseDialog } from "@/features/agents/components/skills/EvaluationCaseDialog";
import {
  SkillEvaluationComparison,
  SkillEvaluationResults,
} from "@/features/agents/components/skills/SkillEvaluationResults";
import { DetailToggleSection } from "@/features/agents/components/instruction/InstructionDetailLayout";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import { fetchAgents } from "@/features/agents/store/agentsThunks";
import { selectSkillById } from "@/features/agents/store/agentSkillsSlice";
import { selectSkillVersionsEntry } from "@/features/agents/store/agentSkillVersionsSlice";
import { fetchSkillVersions } from "@/features/agents/store/agentSkillVersionsThunks";
import { fetchAgentTools } from "@/features/agents/store/agentToolsThunks";
import {
  evaluationIsOpen,
  selectEvaluationCases,
  selectEvaluationRuns,
} from "@/features/agents/store/agentSkillEvaluationsSlice";
import type {
  EvaluationScopeInput,
  EvaluationTargetInput,
  SerializedEvaluationCase,
} from "@/features/agents/store/agentSkillEvaluationsSerde";
import {
  deleteEvaluationCase,
  fetchEvaluationCases,
  fetchEvaluationRuns,
  runSkillEvaluation,
} from "@/features/agents/store/agentSkillEvaluationsThunks";

type SkillEvaluationPanelProps = (
  | { skillId: string; draftId?: string }
  | { draftId: string; skillId?: string }
) & {
  draftContent?: string;
  initialAgentId?: string;
};

export function SkillEvaluationPanel(props: SkillEvaluationPanelProps) {
  const [open, setOpen] = useState(false);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  return (
    <DetailToggleSection
      label="Evaluations"
      summary="check behavior with sample tool responses"
      open={open}
      onToggle={() => setOpen((value) => !value)}
      testId="skill-evaluation-toggle"
    >
      {organizationId && (
        <EvaluationWorkspace
          key={`${organizationId}:${userId}`}
          {...props}
          organizationId={organizationId}
        />
      )}
    </DetailToggleSection>
  );
}

function EvaluationWorkspace({
  skillId,
  draftId,
  draftContent,
  initialAgentId,
  organizationId,
}: SkillEvaluationPanelProps & { organizationId: string }) {
  const dispatch = useAppDispatch();
  const scope = useMemo<EvaluationScopeInput>(
    () => (draftId ? { draftId } : { skillId: skillId! }),
    [draftId, skillId],
  );
  const context = useMemo(() => ({ organizationId, scope }), [organizationId, scope]);
  const agentsById = useAppSelector(selectAllAgents);
  const agents = Object.values(agentsById).filter(
    (agent) => agent.organizationId === organizationId && !agent.isDeleted,
  );
  const [chosenAgentId, setChosenAgentId] = useState(initialAgentId ?? "");
  const agentId =
    agents.find((agent) => agent.id === chosenAgentId)?.id ??
    agents.find((agent) => skillId && agent.enabledSkills.includes(skillId))?.id ??
    agents[0]?.id ??
    "";
  const skill = useAppSelector(selectSkillById(skillId ?? ""));
  const versionsEntry = useAppSelector(selectSkillVersionsEntry(skillId ?? ""));
  const activeVersion = versionsEntry?.versions.find(
    (version) => version.versionNumber === versionsEntry.activeVersionNumber,
  );
  const [chosenVersionId, setChosenVersionId] = useState("");
  const versionId =
    versionsEntry?.versions.find((version) => version.id === chosenVersionId)?.id ??
    activeVersion?.id;
  const target: EvaluationTargetInput | undefined = draftId
    ? { draftId, draftContent }
    : versionId
      ? { skillVersionId: versionId }
      : undefined;
  const cases = useAppSelector(selectEvaluationCases(scope));
  const runs = useAppSelector(selectEvaluationRuns(scope, agentId));
  const state = useAppSelector((root) => root.agentSkillEvaluations);
  const [editing, setEditing] = useState<SerializedEvaluationCase | "create" | null>(null);
  const [deleting, setDeleting] = useState<SerializedEvaluationCase | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [judge, setJudge] = useState(false);
  const [comparison, setComparison] = useState<{ agentId: string; ids: [string, string] } | null>(
    null,
  );
  const retryRequests = useRef(new Map<string, string[]>());
  const hasOpenRuns = runs.some((run) => evaluationIsOpen(run.status));
  const loading = Object.keys(state.requests).length > 0;
  const canRun = Boolean(
    target && agentId && cases.length && !submitting && !versionsEntry?.loading,
  );

  useEffect(() => {
    dispatch(fetchEvaluationCases(context));
    dispatch(fetchAgents());
    dispatch(fetchAgentTools());
  }, [dispatch, context]);
  useEffect(() => {
    if (skillId) dispatch(fetchSkillVersions(skillId));
  }, [dispatch, skillId, skill?.activeVersionNumber, skill?.latestVersionNumber, organizationId]);
  useEffect(() => {
    if (agentId) dispatch(fetchEvaluationRuns({ ...context, agentId }));
  }, [dispatch, context, agentId]);
  useEffect(() => {
    if (!hasOpenRuns || !agentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await dispatch(fetchEvaluationRuns({ ...context, agentId }));
      if (
        !cancelled &&
        fetchEvaluationRuns.fulfilled.match(result) &&
        result.payload.runs.some((run) => evaluationIsOpen(run.status))
      ) {
        timer = setTimeout(poll, 2500);
      }
    };
    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dispatch, context, agentId, hasOpenRuns]);

  const requestRuns = async (caseIds: string[], compare = false) => {
    if (!canRun || !target || submitting) return;
    const targets: EvaluationTargetInput[] =
      compare && activeVersion && draftId
        ? [{ skillVersionId: activeVersion.id }, target]
        : [target];
    const params = { ...context, agentId, caseIds, judge };
    const signature = JSON.stringify({
      ...params,
      targets,
      cases: cases.map((item) => [item.id, item.updatedAt]),
    });
    const ids = retryRequests.current.get(signature) ?? targets.map(() => crypto.randomUUID());
    retryRequests.current.set(signature, ids);
    setSubmitting(true);
    if (compare) setComparison({ agentId, ids: [ids[0], ids[1]] });
    const results = await Promise.all(
      targets.map((evaluationTarget, index) =>
        dispatch(
          runSkillEvaluation({
            ...params,
            target: evaluationTarget,
            requestId: ids[index],
            singleCase: caseIds.length === 1 && !compare,
          }),
        ),
      ),
    );
    if (results.every(runSkillEvaluation.fulfilled.match)) retryRequests.current.delete(signature);
    setSubmitting(false);
  };
  const removeCase = async () => {
    if (!deleting || deletingBusy) return;
    setDeletingBusy(true);
    const result = await dispatch(deleteEvaluationCase({ ...context, caseId: deleting.id }));
    setDeletingBusy(false);
    if (deleteEvaluationCase.fulfilled.match(result)) setDeleting(null);
  };
  const recentActive = activeVersion && runs.find((run) => run.skillVersionId === activeVersion.id);
  const recentDraft = draftId && runs.find((run) => run.draftId === draftId);
  const comparisonIds: [string, string] | undefined =
    comparison?.agentId === agentId
      ? comparison.ids
      : recentActive && recentDraft
        ? [recentActive.requestId, recentDraft.requestId]
        : undefined;

  return (
    <div className="space-y-5" data-testid="skill-evaluation-panel">
      <Card className="space-y-4 p-4 md:p-5">
        <p className="text-sm text-muted-foreground">
          Run saved cases with the selected agent's instructions, tools, and configured model. Tools
          return only your sample responses. Evaluations count toward AI usage and budgets.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Agent</p>
            <Select
              ariaLabel="Evaluation agent"
              value={agentId}
              disabled={submitting}
              options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
              onChange={setChosenAgentId}
              placeholder="Select an accessible agent"
            />
          </div>
          {!draftId && (
            <div>
              <p className="mb-1 text-sm text-muted-foreground">Saved version</p>
              <Select
                ariaLabel="Evaluation version"
                value={versionId}
                disabled={submitting || versionsEntry?.loading}
                options={(versionsEntry?.versions ?? []).map((version) => ({
                  value: version.id,
                  label: `Version ${version.versionNumber}${version.id === activeVersion?.id ? " · Active" : ""}`,
                }))}
                onChange={setChosenVersionId}
                placeholder="Loading versions..."
              />
            </div>
          )}
        </div>
        {draftId && (
          <p className="text-xs text-muted-foreground">
            Runs capture the draft instructions currently in the editor.
          </p>
        )}
        <Checkbox
          label="Judge cases with a rubric"
          checked={judge}
          disabled={submitting}
          description="Adds a separate model call for each rubric, using the agent's configured model."
          onChange={(event) => setJudge(event.target.checked)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            disabled={!canRun}
            onClick={() => void requestRuns(cases.map((item) => item.id))}
          >
            {submitting ? "Requesting..." : "Run suite"}
          </Button>
          {draftId && skillId && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!canRun || !activeVersion}
              onClick={() =>
                void requestRuns(
                  cases.map((item) => item.id),
                  true,
                )
              }
            >
              Compare active version and draft
            </Button>
          )}
        </div>
      </Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            Cases <span className="text-muted-foreground">({cases.length}/25)</span>
          </p>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={cases.length >= 25 || submitting}
            onClick={() => setEditing("create")}
          >
            Add case
          </Button>
        </div>
        {cases.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading cases..."
              : "Add a case to describe the behavior you want to check."}
          </p>
        )}
        {cases.map((item) => (
          <Card key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{item.fields.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.fields.expectedTools.length} expected · {item.fields.forbiddenTools.length}{" "}
                forbidden · {item.fields.fixtures.length} tool responses
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={!canRun}
                onClick={() => void requestRuns([item.id])}
              >
                Run
              </Button>
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={submitting}
                onClick={() => setEditing(item)}
              >
                Edit
              </Button>
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={submitting}
                onClick={() => setDeleting(item)}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {comparisonIds && <SkillEvaluationComparison runs={runs} requestIds={comparisonIds} />}
      {agentId && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Results</p>
            <div className="flex gap-2">
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={loading || submitting}
                onClick={() => dispatch(fetchEvaluationRuns({ ...context, agentId }))}
              >
                Latest
              </Button>
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={loading || submitting || hasOpenRuns || !state.nextCursor}
                onClick={() =>
                  dispatch(fetchEvaluationRuns({ ...context, agentId, cursor: state.nextCursor }))
                }
              >
                Older
              </Button>
            </div>
          </div>
          <SkillEvaluationResults runs={runs} />
        </div>
      )}
      {state.error && (
        <p role="status" className="text-sm text-muted-foreground">
          Some evaluation data could not be loaded. Refresh the cases or results to try again.
        </p>
      )}
      {state.error && (
        <Button
          className="min-h-11"
          variant="ghost"
          onClick={() => dispatch(fetchEvaluationCases(context))}
        >
          Refresh cases
        </Button>
      )}
      {editing && (
        <EvaluationCaseDialog
          key={editing === "create" ? "create" : editing.id}
          context={context}
          evaluationCase={editing === "create" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={removeCase}
        title="Delete evaluation case"
        message={`Delete ${deleting?.fields.name ?? "this case"}? Past results keep their captured case.`}
        confirmLabel="Delete"
        loading={deletingBusy}
      />
    </div>
  );
}
