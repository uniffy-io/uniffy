import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ClockCounterClockwise,
  Lightning,
  PushPin,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaneBackLink, PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import {
  deleteSkill,
  fetchSkills,
  updateSkill,
  type SerializedSkill,
} from "@/features/agents/store/agentSkillsThunks";
import {
  discardSkillDraft,
  saveSkillDraft,
  type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";
import { selectAllSkills } from "@/features/agents/store/agentSkillsSlice";
import { selectSkillVersionsEntry } from "@/features/agents/store/agentSkillVersionsSlice";
import {
  fetchSkillVersions,
  revertSkill,
  setMainSkillVersion,
} from "@/features/agents/store/agentSkillVersionsThunks";
import { parseSkillNameConflict } from "@/features/agents/utils/skillDraftErrors";
import { deriveSkillSlug } from "@/features/agents/utils/skillSlug";
import { SKILL_EDITOR_PLACEHOLDER } from "@/features/agents/config/skillEditor";
import { InstructionVersionHistory } from "@/features/agents/components/instruction/InstructionVersionHistory";
import { SkillMetricsPanel } from "@/features/agents/components/skills/SkillMetricsPanel";
import { SkillEvaluationPanel } from "@/features/agents/components/skills/SkillEvaluationPanel";
import {
  DETAIL_EDITOR_MIN_HEIGHT,
  DetailBody,
  DetailCard,
  DetailEditorCard,
  DetailField,
  DetailFieldRow,
  DetailReadOnlyValue,
  DetailSection,
  DetailTextField,
  DetailToggleSection,
  detailEditorClass,
} from "@/features/agents/components/instruction/InstructionDetailLayout";
import {
  headerButtonClass,
  headerChipActiveClass,
  headerChipClass,
} from "@/features/agents/components/instruction/detailChrome";

const INSTRUCTIONS_HINT =
  "Markdown the agent loads when the skill is invoked. Type / for headings, lists, and code.";

function sourceLabel(source: number): string {
  switch (source) {
    case SkillSource.BUNDLED:
      return "Bundled";
    case SkillSource.ORGANIZATION:
      return "Organization";
    default:
      return "Unknown";
  }
}

function VersionHistorySection({
  skill,
  canEdit,
  onContentReplaced,
}: {
  skill: SerializedSkill;
  canEdit: boolean;
  onContentReplaced: () => void;
}) {
  const dispatch = useAppDispatch();
  const entry = useAppSelector(selectSkillVersionsEntry(skill.id));

  useEffect(() => {
    dispatch(fetchSkillVersions(skill.id));
  }, [dispatch, skill.id]);

  const versions = useMemo(() => entry?.versions ?? [], [entry?.versions]);

  return (
    <InstructionVersionHistory
      versions={versions}
      activeVersionNumber={entry?.activeVersionNumber ?? 0}
      latestVersionNumber={entry?.latestVersionNumber ?? 0}
      pinned={entry?.activeVersionPinned ?? false}
      loading={entry?.loading ?? false}
      canEdit={canEdit}
      onFollowLatest={async () => {
        await dispatch(setMainSkillVersion({ skillId: skill.id, followLatest: true })).unwrap();
        onContentReplaced();
      }}
      onSetMain={async (versionNumber) => {
        await dispatch(
          setMainSkillVersion({ skillId: skill.id, versionNumber, followLatest: false }),
        ).unwrap();
        onContentReplaced();
      }}
      onRevert={async (versionNumber) => {
        await dispatch(revertSkill({ skillId: skill.id, versionNumber })).unwrap();
        onContentReplaced();
      }}
      testId="skill-detail-version-history"
    />
  );
}

function SkillRequirements({
  requiresTools,
  supportedSurfaces,
}: {
  requiresTools: string[];
  supportedSurfaces: string[];
}) {
  return (
    <DetailFieldRow>
      <DetailField
        label="Invocation"
        hint={`Supported surfaces: ${
          supportedSurfaces.length ? supportedSurfaces.join(", ") : "chat and test sessions"
        }.`}
      >
        <p className="text-sm text-foreground">
          Runs only when you invoke it on an agent it is assigned to.
        </p>
      </DetailField>
      <DetailField
        label="Required tools"
        hint="The agent must have these enabled to run the skill."
      >
        {requiresTools.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="skill-requirements">
            {requiresTools.map((tool) => (
              <Badge key={tool} variant="outline" className="font-mono">
                {tool}
              </Badge>
            ))}
          </div>
        )}
      </DetailField>
    </DetailFieldRow>
  );
}

function SavedSkillDetail({ skill }: { skill: SerializedSkill }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isBuilder } = useAgentsBuilderAccess();

  const isBundled = skill.source === SkillSource.BUNDLED;
  const canEdit = !isBundled && isBuilder;

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLElement | null>(null);
  // Observations fetch on open only: most visits are edits, not reviews.
  const [observationsOpen, setObservationsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Version restores replace the content outside the editor; remounting is the
  // only way the seeded editor picks the new body up.
  const [editorEpoch, setEditorEpoch] = useState(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (markdown: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        dispatch(updateSkill({ skillId: skill.id, content: markdown }));
      }, 800);
    },
    [dispatch, skill.id],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const handleContentReplaced = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setEditorEpoch((n) => n + 1);
  }, []);

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    requestAnimationFrame(() => {
      historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleConfirmDelete = async () => {
    setDeleteBusy(true);
    try {
      await dispatch(deleteSkill(skill.id)).unwrap();
      navigate("/agents/skills");
    } finally {
      setDeleteBusy(false);
    }
  };

  const versionSummary = skill.activeVersionPinned
    ? `pinned to v${skill.activeVersionNumber || 1}`
    : `v${skill.activeVersionNumber || 1}, following the latest edit`;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skill-detail">
      <PaneHeader>
        <PaneHeaderBar
          eyebrow={
            <PaneBackLink
              onClick={() => navigate("/agents/skills")}
              data-testid="skill-detail-back"
            >
              <ArrowLeft size={14} />
              All skills
            </PaneBackLink>
          }
          icon={Lightning}
          title={skill.displayName || "Untitled skill"}
          subtitle={skill.description || undefined}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary" data-testid="skill-detail-source-chip">
              {sourceLabel(skill.source)}
            </Badge>
            <button
              type="button"
              onClick={toggleHistory}
              className={cn(headerChipClass, historyOpen && headerChipActiveClass)}
              title="Version history"
              data-testid="skill-detail-history-chip"
            >
              {skill.activeVersionPinned ? (
                <PushPin size={14} weight="fill" />
              ) : (
                <ClockCounterClockwise size={14} />
              )}
              v{skill.activeVersionNumber || 1}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={headerButtonClass}
                aria-label="Delete skill"
                title="Delete skill"
                data-testid="skill-detail-delete"
              >
                <Trash size={14} />
              </button>
            )}
          </div>
        </PaneHeaderBar>
      </PaneHeader>

      <DetailBody>
        <DetailSection label="Details" testId="skill-detail-metadata">
          <DetailCard className="space-y-5">
            <DetailFieldRow>
              <DetailTextField
                key={`name:${editorEpoch}`}
                label="Title"
                value={skill.displayName}
                required
                disabled={!canEdit}
                placeholder="Untitled skill"
                onCommit={(next) => dispatch(updateSkill({ skillId: skill.id, displayName: next }))}
                testId="skill-detail-name"
              />
              <DetailField
                label="Identifier"
                hint="Fixed at creation. Agents invoke the skill by this name."
              >
                <DetailReadOnlyValue mono testId="skill-detail-slug">
                  {skill.name}
                </DetailReadOnlyValue>
              </DetailField>
            </DetailFieldRow>
            <DetailTextField
              key={`description:${editorEpoch}`}
              label="Description"
              value={skill.description}
              disabled={!canEdit}
              placeholder="What this skill is for"
              hint="Shown in the skills list so users can choose when to invoke it."
              onCommit={(next) => dispatch(updateSkill({ skillId: skill.id, description: next }))}
              testId="skill-detail-description"
            />
            <SkillRequirements
              requiresTools={skill.requiresTools}
              supportedSurfaces={skill.supportedSurfaces}
            />
          </DetailCard>
        </DetailSection>

        <DetailSection label="Instructions" hint={INSTRUCTIONS_HINT}>
          <DetailEditorCard
            testId="skill-detail-editor"
            footer={
              isBundled
                ? "Bundled skills ship with Uniffy and cannot be edited or deleted."
                : undefined
            }
          >
            <CrepeEditor
              key={`${skill.id}:${editorEpoch}`}
              contentType={ContentType.AGENT}
              contentId={skill.id}
              value={skill.content}
              onChange={canEdit ? handleContentChange : undefined}
              readonly={!canEdit}
              enableUpload={false}
              allowImages={false}
              compact
              minHeight={DETAIL_EDITOR_MIN_HEIGHT}
              className={detailEditorClass}
              placeholder={SKILL_EDITOR_PLACEHOLDER}
            />
          </DetailEditorCard>
        </DetailSection>

        {isBuilder && <SkillEvaluationPanel skillId={skill.id} />}

        <DetailToggleSection
          label="Version history"
          summary={versionSummary}
          open={historyOpen}
          onToggle={toggleHistory}
          sectionRef={historyRef}
          testId="skill-detail-history-toggle"
        >
          <DetailCard>
            <VersionHistorySection
              skill={skill}
              canEdit={canEdit}
              onContentReplaced={handleContentReplaced}
            />
          </DetailCard>
        </DetailToggleSection>

        <DetailToggleSection
          label="Observations"
          summary="how each version ran when agents invoked it"
          open={observationsOpen}
          onToggle={() => setObservationsOpen((open) => !open)}
          testId="skill-detail-observations-toggle"
        >
          <SkillMetricsPanel skillId={skill.id} tone="card" testId="skill-detail-observations" />
        </DetailToggleSection>
      </DetailBody>

      <ConfirmDialog
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={handleConfirmDelete}
        title="Delete skill"
        message={
          <>
            Delete <span className="font-medium text-foreground">{skill.displayName}</span>? This
            removes the skill and all its versions, and unenrolls it from every agent. This cannot
            be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteBusy}
      />
    </div>
  );
}

function AgentDraftNotice({ rationale }: { rationale: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
      data-testid="skill-detail-agent-notice"
    >
      <Sparkle size={18} weight="fill" className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">Proposed by an agent</p>
        {rationale && <p className="text-sm text-muted-foreground">{rationale}</p>}
        <p className="text-xs text-muted-foreground">
          Review and adjust it freely. Nothing changes for any agent until you save.
        </p>
      </div>
    </div>
  );
}

// The reviewer's edits are authoritative: the full field set is sent on save, so
// what they see is exactly what the saved version captures. SaveSkillDraft has no
// partial-update variant, so edits stay local until an explicit save.
function DraftDetail({ draft }: { draft: SerializedSkillDraft }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const skills = useAppSelector(selectAllSkills);

  const [displayName, setDisplayName] = useState(draft.displayName ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [content, setContent] = useState(draft.content ?? "");
  const [busy, setBusy] = useState<"save" | "discard" | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);

  const isEdit = draft.kind !== "create";
  const fromAgent = Boolean(draft.proposedByAgentId);
  const canSave = displayName.trim().length > 0 && busy === null;

  // An edit draft targets an existing skill, so its slug is already fixed; a
  // create draft derives one from the title and never asks for it.
  const takenSlugs = useMemo(() => Object.values(skills).map((s) => s.name), [skills]);
  const slug = isEdit ? (draft.name ?? "") : deriveSkillSlug(displayName.trim(), takenSlugs);

  const kindLabel = isEdit ? (draft.kind === "evolve" ? "Improvement" : "Edit") : "New skill";

  // The backend refuses a create draft whose identifier is already taken until
  // the reviewer accepts that saving versions that existing skill instead.
  const submitSave = async (allowReplace: boolean) => {
    setBusy("save");
    try {
      const result = await dispatch(
        saveSkillDraft({
          draftId: draft.id,
          allowReplace,
          fields: {
            name: slug,
            displayName: displayName.trim(),
            description: description.trim(),
            content: content.trim(),
            requiresTools: draft.requiresTools,
            supportedSurfaces: draft.supportedSurfaces,
          },
        }),
      ).unwrap();
      setReplaceTarget(null);
      dispatch(fetchSkills());
      navigate(`/agents/skills/${result.skill.id}`);
    } catch (error) {
      setBusy(null);
      if (allowReplace) return;
      const conflict = parseSkillNameConflict(error);
      if (conflict) setReplaceTarget(conflict.existingSkillName || slug);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    void submitSave(false);
  };

  const handleDiscard = async () => {
    setBusy("discard");
    try {
      await dispatch(discardSkillDraft(draft.id)).unwrap();
      navigate("/agents/skills");
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skill-detail">
      <PaneHeader>
        <PaneHeaderBar
          eyebrow={
            <PaneBackLink
              onClick={() => navigate("/agents/skills")}
              data-testid="skill-detail-back"
            >
              <ArrowLeft size={14} />
              All skills
            </PaneBackLink>
          }
          icon={Lightning}
          title={displayName.trim() || "Untitled skill"}
          subtitle={
            description.trim() ||
            (isEdit ? `New version of ${draft.name}` : "Draft, not active until saved")
          }
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={headerChipClass}>Draft - {kindLabel}</span>
            {fromAgent && (
              <span className={cn(headerChipClass, "text-primary")}>
                <Sparkle size={12} weight="fill" />
                Proposed by agent
              </span>
            )}
            <button
              type="button"
              onClick={handleDiscard}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-50"
              data-testid="skill-detail-discard-draft"
            >
              <Trash size={14} />
              {busy === "discard" ? "Discarding..." : "Discard"}
            </button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              data-testid="skill-detail-save-draft"
            >
              {busy === "save" ? "Saving..." : isEdit ? "Save new version" : "Save skill"}
            </Button>
          </div>
        </PaneHeaderBar>
      </PaneHeader>

      <DetailBody>
        {fromAgent && <AgentDraftNotice rationale={draft.rationale} />}

        <DetailSection label="Details" testId="skill-detail-metadata">
          <DetailCard className="space-y-5">
            <DetailFieldRow>
              <DetailTextField
                label="Title"
                value={displayName}
                live
                autoFocus={!isEdit && !displayName}
                placeholder="Give the skill a name"
                onCommit={setDisplayName}
                testId="skill-detail-name"
              />
              <DetailField
                label="Identifier"
                hint={
                  isEdit
                    ? "Fixed: this draft saves a new version of the existing skill."
                    : "Derived from the title and fixed once saved."
                }
              >
                <DetailReadOnlyValue mono testId="skill-detail-slug">
                  {slug}
                </DetailReadOnlyValue>
              </DetailField>
            </DetailFieldRow>
            <DetailTextField
              label="Description"
              value={description}
              live
              placeholder="What this skill is for"
              hint="Shown in the skills list so users can choose when to invoke it."
              onCommit={setDescription}
              testId="skill-detail-description"
            />
            {!fromAgent && draft.rationale && (
              <DetailField label="Rationale">
                <p className="text-sm text-muted-foreground">{draft.rationale}</p>
              </DetailField>
            )}
            <SkillRequirements
              requiresTools={draft.requiresTools}
              supportedSurfaces={draft.supportedSurfaces}
            />
          </DetailCard>
        </DetailSection>

        <DetailSection label="Instructions" hint={INSTRUCTIONS_HINT}>
          <DetailEditorCard testId="skill-detail-editor">
            <CrepeEditor
              key={draft.id}
              contentType={ContentType.AGENT}
              contentId={draft.targetSkillId ?? ""}
              value={content}
              onChange={setContent}
              enableUpload={false}
              allowImages={false}
              compact
              minHeight={DETAIL_EDITOR_MIN_HEIGHT}
              className={detailEditorClass}
              placeholder={SKILL_EDITOR_PLACEHOLDER}
            />
          </DetailEditorCard>
        </DetailSection>
        <SkillEvaluationPanel
          draftId={draft.id}
          skillId={draft.targetSkillId}
          draftContent={content}
          initialAgentId={draft.proposedByAgentId}
        />
      </DetailBody>

      <ConfirmDialog
        isOpen={replaceTarget !== null}
        onClose={() => setReplaceTarget(null)}
        onConfirm={() => void submitSave(true)}
        title="Replace existing skill"
        message={
          <>
            A skill named <span className="font-medium text-foreground">{replaceTarget}</span>{" "}
            already exists. Saving replaces its content with a new version, which every agent using
            it picks up.
          </>
        }
        confirmLabel="Replace"
        variant="warning"
        loading={busy === "save"}
      />
    </div>
  );
}

interface SkillDetailProps {
  skill?: SerializedSkill;
  draft?: SerializedSkillDraft;
}

export function SkillDetail({ skill, draft }: SkillDetailProps) {
  if (draft) return <DraftDetail key={draft.id} draft={draft} />;
  if (skill) return <SavedSkillDetail key={skill.id} skill={skill} />;
  return null;
}
