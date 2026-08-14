import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  CaretDown,
  CaretRight,
  CircleNotch,
  ClockCounterClockwise,
  PushPin,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";
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
import { diffStat } from "@/features/agents/utils/skillDiff";
import { parseSkillNameConflict } from "@/features/agents/utils/skillDraftErrors";
import { deriveSkillSlug } from "@/features/agents/utils/skillSlug";
import { SKILL_EDITOR_PLACEHOLDER } from "@/features/agents/config/skillEditor";
import { SkillVersionDiff } from "@/features/agents/components/skills/SkillVersionDiff";

const headerButtonClass = cn(
  "group/btn relative flex items-center justify-center h-7 w-7 rounded-md",
  "border border-foreground/15 bg-transparent text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-foreground/30 hover:bg-muted hover:text-primary",
);

const headerChipClass = cn(
  "group/btn flex items-center gap-1 h-7 px-1.5 rounded-md",
  "border border-foreground/15 bg-transparent text-xs text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-foreground/30 hover:bg-muted hover:text-primary",
);

const headerChipActiveClass =
  "text-primary bg-primary/10 border-primary/50 hover:border-primary/50 hover:bg-primary/10";

const sectionLabelClass = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

const fieldInputClass =
  "w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

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

interface InlineTextEditProps {
  value: string;
  onSave: (next: string) => void;
  canEdit: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
  startEditing?: boolean;
}

function InlineTextEdit({
  value,
  onSave,
  canEdit,
  allowEmpty = false,
  placeholder,
  className,
  testId,
  startEditing = false,
}: InlineTextEditProps) {
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(value);

  if (editing) {
    const commit = () => {
      setEditing(false);
      const next = text.trim();
      if (!next && !allowEmpty) return;
      if (next !== value) onSave(next);
    };
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        data-testid={testId}
        className={cn(
          "w-full bg-transparent border-b border-primary/50 focus:outline-none",
          className,
        )}
      />
    );
  }

  if (!canEdit) {
    return (
      <p
        className={cn(className, !value && "text-muted-foreground/60 italic")}
        data-testid={testId}
      >
        {value || placeholder}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setText(value);
        setEditing(true);
      }}
      title="Click to edit"
      data-testid={testId}
      className={cn(
        "block w-full text-left rounded px-1 -mx-1 cursor-text hover:bg-muted/60 transition-colors",
        className,
        !value && "text-muted-foreground/60 italic",
      )}
    >
      {value || placeholder}
    </button>
  );
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
  const [busy, setBusy] = useState<number | "follow" | null>(null);
  // Null until the user picks a pair of their own; "main vs latest" applies until then.
  const [compareOverride, setCompareOverride] = useState<{ base: number; target: number } | null>(
    null,
  );

  useEffect(() => {
    dispatch(fetchSkillVersions(skill.id));
  }, [dispatch, skill.id]);

  const versions = useMemo(() => entry?.versions ?? [], [entry?.versions]);
  const activeNumber = entry?.activeVersionNumber ?? 0;
  const pinned = entry?.activeVersionPinned ?? false;

  const compare = useMemo(() => {
    if (compareOverride) return compareOverride;
    if (versions.length < 2 || !entry) return null;
    const latest = entry.latestVersionNumber;
    const base =
      entry.activeVersionNumber && entry.activeVersionNumber !== latest
        ? entry.activeVersionNumber
        : versions[1].versionNumber;
    return { base, target: latest };
  }, [compareOverride, entry, versions]);

  const byNumber = useMemo(() => {
    const map = new Map<number, (typeof versions)[number]>();
    for (const v of versions) map.set(v.versionNumber, v);
    return map;
  }, [versions]);

  const handleFollowLatest = async () => {
    setBusy("follow");
    try {
      await dispatch(setMainSkillVersion({ skillId: skill.id, followLatest: true })).unwrap();
      onContentReplaced();
    } finally {
      setBusy(null);
    }
  };

  const handleSetMain = async (versionNumber: number) => {
    setBusy(versionNumber);
    try {
      await dispatch(
        setMainSkillVersion({ skillId: skill.id, versionNumber, followLatest: false }),
      ).unwrap();
      onContentReplaced();
    } finally {
      setBusy(null);
    }
  };

  const handleRevert = async (versionNumber: number) => {
    setBusy(versionNumber);
    try {
      await dispatch(revertSkill({ skillId: skill.id, versionNumber })).unwrap();
      onContentReplaced();
    } finally {
      setBusy(null);
    }
  };

  const baseVersion = compare ? byNumber.get(compare.base) : undefined;
  const targetVersion = compare ? byNumber.get(compare.target) : undefined;

  return (
    <div className="space-y-3" data-testid="skill-detail-version-history">
      <p className={sectionLabelClass}>Version history</p>
      <p className="text-xs text-muted-foreground">
        {pinned ? `Pinned to version ${activeNumber}` : "Following the latest edit automatically"}
      </p>

      {canEdit && pinned && (
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={false}
            disabled={busy !== null}
            onChange={handleFollowLatest}
            className="accent-primary"
          />
          Use the latest version automatically
        </label>
      )}

      {compare && baseVersion && targetVersion && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Compare</span>
            <Select
              value={compare.base}
              onChange={(value) => setCompareOverride({ ...compare, base: value })}
              size="sm"
              triggerClassName="min-w-0 w-20"
              options={versions.map((v) => ({
                value: v.versionNumber,
                label: `v${v.versionNumber}`,
              }))}
            />
            <span>with</span>
            <Select
              value={compare.target}
              onChange={(value) => setCompareOverride({ ...compare, target: value })}
              size="sm"
              triggerClassName="min-w-0 w-20"
              options={versions.map((v) => ({
                value: v.versionNumber,
                label: `v${v.versionNumber}`,
              }))}
            />
          </div>
          <div className="max-h-64 overflow-hidden flex flex-col">
            <SkillVersionDiff
              oldText={baseVersion.content}
              newText={targetVersion.content}
              oldLabel={`v${baseVersion.versionNumber}`}
              newLabel={`v${targetVersion.versionNumber}`}
            />
          </div>
        </div>
      )}

      {entry?.loading && versions.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <CircleNotch size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {!entry?.loading && versions.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No version history yet.</p>
      )}

      <div className="space-y-2">
        {versions.map((version, i) => {
          const prev = versions[i + 1];
          const stat = prev ? diffStat(prev.content, version.content) : null;
          const isMain = version.versionNumber === activeNumber;
          const rowBusy = busy === version.versionNumber;
          return (
            <div
              key={version.id}
              className={cn(
                "rounded-lg border px-3 py-2.5",
                isMain ? "border-primary/40 bg-primary/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  v{version.versionNumber}
                </span>
                {isMain && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">
                    {pinned && <PushPin size={11} weight="fill" />}
                    Main
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {version.authorKind === "agent" ? "Agent" : "User"}
                </span>
                {stat && (stat.added > 0 || stat.removed > 0) && (
                  <span className="text-xs font-mono">
                    <span className="text-green-600 dark:text-green-400">+{stat.added}</span>{" "}
                    <span className="text-red-500">-{stat.removed}</span>
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatProtoDateTime(version.createdAt)}
                </span>
              </div>
              {version.changeSummary && (
                <p className="text-xs text-muted-foreground mt-1">{version.changeSummary}</p>
              )}
              {canEdit && (
                <div className="flex items-center gap-3 mt-2">
                  {!isMain && (
                    <button
                      type="button"
                      onClick={() => handleSetMain(version.versionNumber)}
                      disabled={busy !== null}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {rowBusy ? "Working..." : "Set as main"}
                    </button>
                  )}
                  {version.versionNumber !== entry?.latestVersionNumber && (
                    <button
                      type="button"
                      onClick={() => handleRevert(version.versionNumber)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <ArrowCounterClockwise size={12} />
                      Revert to this
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SavedSkillDetail({ skill }: { skill: SerializedSkill }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isBuilder } = useAgentsBuilderAccess();

  const isBundled = skill.source === SkillSource.BUNDLED;
  const canEdit = !isBundled && isBuilder;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Version restores replace the content outside the editor; remounting is the
  // only way the seeded editor picks the new body up.
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [whenToUse, setWhenToUse] = useState(skill.whenToUse);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whenToUseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (markdown: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        dispatch(updateSkill({ skillId: skill.id, content: markdown }));
      }, 800);
    },
    [dispatch, skill.id],
  );

  const handleWhenToUseChange = useCallback(
    (next: string) => {
      setWhenToUse(next);
      if (whenToUseTimeoutRef.current) clearTimeout(whenToUseTimeoutRef.current);
      whenToUseTimeoutRef.current = setTimeout(() => {
        dispatch(updateSkill({ skillId: skill.id, whenToUse: next }));
      }, 800);
    },
    [dispatch, skill.id],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (whenToUseTimeoutRef.current) clearTimeout(whenToUseTimeoutRef.current);
    };
  }, []);

  const handleContentReplaced = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setEditorEpoch((n) => n + 1);
  }, []);

  const handleConfirmDelete = async () => {
    setDeleteBusy(true);
    try {
      await dispatch(deleteSkill(skill.id)).unwrap();
      navigate("/agents/skills");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skill-detail">
      <div className="px-6 py-4 border-b border-border">
        <button
          type="button"
          onClick={() => navigate("/agents/skills")}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid="skill-detail-back"
        >
          <ArrowLeft size={14} />
          All skills
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <InlineTextEdit
              value={skill.displayName}
              canEdit={canEdit}
              onSave={(next) => dispatch(updateSkill({ skillId: skill.id, displayName: next }))}
              placeholder="Untitled skill"
              className="text-xl font-semibold text-foreground"
              testId="skill-detail-name"
            />
            <InlineTextEdit
              value={skill.description}
              canEdit={canEdit}
              allowEmpty
              onSave={(next) => dispatch(updateSkill({ skillId: skill.id, description: next }))}
              placeholder="No description provided"
              className="mt-0.5 text-sm text-muted-foreground"
              testId="skill-detail-description"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" data-testid="skill-detail-source-chip">
              {sourceLabel(skill.source)}
            </Badge>
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className={cn(headerChipClass, detailsOpen && headerChipActiveClass)}
              data-testid="skill-detail-metadata-toggle"
            >
              <ClockCounterClockwise size={14} />v{skill.activeVersionNumber || 1}
              {detailsOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={headerButtonClass}
                aria-label="Delete skill"
                data-testid="skill-detail-delete"
              >
                <Trash size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {detailsOpen && (
        <div
          className="border-b border-border px-6 py-4 max-h-[50%] overflow-y-auto"
          data-testid="skill-detail-metadata"
        >
          <div className="space-y-4">
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>Identifier</p>
              <p className="text-sm font-mono text-foreground" data-testid="skill-detail-slug">
                {skill.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Fixed at creation. Rename the skill from its title.
              </p>
            </div>
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>When to use</p>
              {canEdit ? (
                <input
                  type="text"
                  value={whenToUse}
                  onChange={(e) => handleWhenToUseChange(e.target.value)}
                  placeholder="When to use this skill (trigger guidance)"
                  data-testid="skill-detail-when-to-use"
                  className={fieldInputClass}
                />
              ) : (
                <p
                  className={cn(
                    "text-sm",
                    skill.whenToUse ? "text-foreground" : "text-muted-foreground/60 italic",
                  )}
                  data-testid="skill-detail-when-to-use"
                >
                  {skill.whenToUse || "No trigger guidance set"}
                </p>
              )}
            </div>
            <div className="border-b border-border pb-3 space-y-1.5">
              <p className={sectionLabelClass}>Activation</p>
              <div className="flex flex-wrap items-center gap-2">
                {skill.source === SkillSource.ORGANIZATION && canEdit ? (
                  <div
                    className="flex items-center gap-2 text-sm text-foreground"
                    data-testid="skill-detail-always-active"
                  >
                    <ToggleSwitch
                      size="sm"
                      enabled={skill.alwaysActive}
                      onChange={(next) =>
                        dispatch(
                          updateSkill({
                            skillId: skill.id,
                            alwaysActive: next,
                          }),
                        )
                      }
                    />
                    Always active
                  </div>
                ) : skill.alwaysActive ? (
                  <Badge variant="outline">Always loaded</Badge>
                ) : (
                  <Badge variant="secondary">Loaded on demand</Badge>
                )}
                {skill.requiresTools.length > 0 && (
                  <span className="text-xs text-muted-foreground">Requires tools:</span>
                )}
                {skill.requiresTools.map((tool) => (
                  <Badge key={tool} variant="outline" className="font-mono">
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>
            <VersionHistorySection
              skill={skill}
              canEdit={canEdit}
              onContentReplaced={handleContentReplaced}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-card" data-testid="skill-detail-editor">
        <CrepeEditor
          key={`${skill.id}:${editorEpoch}`}
          contentType={ContentType.AGENT}
          contentId={skill.id}
          value={skill.content}
          onChange={canEdit ? handleContentChange : undefined}
          readonly={!canEdit}
          enableUpload={false}
          allowImages={false}
          placeholder={SKILL_EDITOR_PLACEHOLDER}
        />
      </div>

      {isBundled && (
        <div className="px-6 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Bundled skills ship with Uniffy and cannot be edited or deleted.
          </p>
        </div>
      )}

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

// The reviewer's edits are authoritative: the full field set is sent on save, so
// what they see is exactly what the saved version captures. SaveSkillDraft has no
// partial-update variant, so edits stay local until an explicit save.
function DraftDetail({ draft }: { draft: SerializedSkillDraft }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const skills = useAppSelector(selectAllSkills);

  const [displayName, setDisplayName] = useState(draft.displayName ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [whenToUse, setWhenToUse] = useState(draft.whenToUse ?? "");
  const [content, setContent] = useState(draft.content ?? "");
  const [alwaysActive, setAlwaysActive] = useState(draft.suggestedAlwaysActive);
  const [busy, setBusy] = useState<"save" | "discard" | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
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
            whenToUse: whenToUse.trim(),
            requiresTools: draft.requiresTools,
            requiresContext: draft.requiresContext,
            suggestedAlwaysActive: alwaysActive,
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
      navigate("/agents/skills/drafts");
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skill-detail">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <InlineTextEdit
              value={displayName}
              canEdit
              onSave={setDisplayName}
              startEditing={!isEdit && !displayName}
              placeholder="Untitled skill"
              className="text-xl font-semibold text-foreground"
              testId="skill-detail-name"
            />
            <InlineTextEdit
              value={description}
              canEdit
              allowEmpty
              onSave={setDescription}
              placeholder="Add a description"
              className="mt-0.5 text-sm text-muted-foreground"
              testId="skill-detail-description"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50 px-2"
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
        </div>
        {fromAgent && (
          <p className="mt-1 text-xs text-muted-foreground">
            Drafted by the agent - it is not active until you save it.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className="flex items-center gap-1.5 px-6 py-2 border-b border-border text-left"
        data-testid="skill-detail-metadata-toggle"
      >
        {detailsOpen ? (
          <CaretDown size={12} className="text-muted-foreground" />
        ) : (
          <CaretRight size={12} className="text-muted-foreground" />
        )}
        <span className={sectionLabelClass}>Details</span>
      </button>

      {detailsOpen && (
        <div
          className="border-b border-border px-6 py-4 max-h-[45%] overflow-y-auto"
          data-testid="skill-detail-metadata"
        >
          <div className="space-y-4">
            {draft.rationale && (
              <div className="border-b border-border pb-3 space-y-1">
                <p className={sectionLabelClass}>Rationale</p>
                <p className="text-sm text-muted-foreground">{draft.rationale}</p>
              </div>
            )}
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>Identifier</p>
              <p className="text-sm font-mono text-foreground" data-testid="skill-detail-slug">
                {slug}
              </p>
              <p className="text-xs text-muted-foreground">
                Derived from the title and fixed once saved.
              </p>
            </div>
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>When to use</p>
              <input
                type="text"
                value={whenToUse}
                onChange={(e) => setWhenToUse(e.target.value)}
                placeholder="When to use this skill (trigger guidance)"
                className={fieldInputClass}
              />
            </div>
            <div className="space-y-1.5">
              <p className={sectionLabelClass}>Activation</p>
              <div
                className="flex items-center gap-2 text-sm text-foreground"
                data-testid="skill-draft-always-active"
              >
                <ToggleSwitch size="sm" enabled={alwaysActive} onChange={setAlwaysActive} />
                Always active
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-card" data-testid="skill-detail-editor">
        <CrepeEditor
          key={draft.id}
          contentType={ContentType.AGENT}
          contentId={draft.targetSkillId ?? ""}
          value={content}
          onChange={setContent}
          enableUpload={false}
          allowImages={false}
          placeholder={SKILL_EDITOR_PLACEHOLDER}
        />
      </div>

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
