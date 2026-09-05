import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  ArrowUUpLeft,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  ListChecks,
  PushPin,
  Trash,
} from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { RuleSource, RuleStatus } from "@uniffy/proto/agents/v1/rules_pb";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaneBackLink, PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import {
  changeRuleStatus,
  changeRuleVersion,
  fetchRuleVersions,
  saveRule,
  type SerializedRule,
} from "@/features/agents/store/agentRulesThunks";
import { deriveSkillSlug } from "@/features/agents/utils/skillSlug";
import { RULE_EDITOR_PLACEHOLDER } from "@/features/agents/config/skillEditor";
import { InlineTextEdit } from "@/features/agents/components/instruction/InlineTextEdit";
import { InstructionVersionHistory } from "@/features/agents/components/instruction/InstructionVersionHistory";
import {
  headerButtonClass,
  headerChipActiveClass,
  headerChipClass,
  sectionLabelClass,
} from "@/features/agents/components/instruction/detailChrome";

function sourceLabel(source: number): string {
  switch (source) {
    case RuleSource.BUNDLED:
      return "Bundled";
    case RuleSource.ORGANIZATION:
      return "Organization";
    default:
      return "Unknown";
  }
}

function RuleVersionHistory({
  rule,
  canEdit,
  onContentReplaced,
}: {
  rule: SerializedRule;
  canEdit: boolean;
  onContentReplaced: (next: SerializedRule) => void;
}) {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((s) => s.agentRules.versions[rule.id]);
  const loading = useAppSelector((s) => s.agentRules.versionsLoading[rule.id] ?? false);

  // Every save stages a version, so the list refreshes whenever the latest number moves.
  useEffect(() => {
    dispatch(fetchRuleVersions({ ruleId: rule.id }));
  }, [dispatch, rule.id, rule.latestVersionNumber]);

  const versions = useMemo(() => entry?.items ?? [], [entry?.items]);
  const activeVersionNumber =
    versions.find((v) => v.id === rule.activeVersionId)?.versionNumber ??
    (rule.activeVersionPinned ? 0 : rule.latestVersionNumber);

  const change = async (versionNumber: number, action: "pin" | "follow" | "revert") => {
    const next = await dispatch(
      changeRuleVersion({ ruleId: rule.id, versionNumber, action }),
    ).unwrap();
    onContentReplaced(next);
  };

  return (
    <InstructionVersionHistory
      versions={versions}
      activeVersionNumber={activeVersionNumber}
      latestVersionNumber={rule.latestVersionNumber}
      pinned={rule.activeVersionPinned}
      loading={loading}
      canEdit={canEdit}
      onFollowLatest={() => change(rule.latestVersionNumber, "follow")}
      onSetMain={(versionNumber) => change(versionNumber, "pin")}
      onRevert={(versionNumber) => change(versionNumber, "revert")}
      onLoadMore={
        entry?.nextPageToken
          ? () => dispatch(fetchRuleVersions({ ruleId: rule.id, pageToken: entry.nextPageToken }))
          : undefined
      }
      testId="rule-detail-version-history"
    />
  );
}

function SavedRuleDetail({ rule }: { rule: SerializedRule }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isBuilder } = useAgentsBuilderAccess();

  const isBundled = rule.source === RuleSource.BUNDLED;
  const retired = rule.status === RuleStatus.RETIRED;
  const canEdit = !isBundled && isBuilder;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  // Version restores replace the content outside the editor; remounting is the
  // only way the seeded editor picks the new body up.
  const [editorEpoch, setEditorEpoch] = useState(0);
  // UpdateRule takes the whole field set, so the latest local values travel
  // together: a title commit must not send content that is still debouncing.
  const fieldsRef = useRef({
    displayName: rule.displayName,
    description: rule.description,
    content: rule.content,
  });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    dispatch(saveRule({ ruleId: rule.id, name: rule.name, ...fieldsRef.current }));
  }, [dispatch, rule.id, rule.name]);

  const handleTitleSave = useCallback(
    (displayName: string) => {
      fieldsRef.current = { ...fieldsRef.current, displayName };
      flush();
    },
    [flush],
  );

  const handleDescriptionSave = useCallback(
    (description: string) => {
      fieldsRef.current = { ...fieldsRef.current, description };
      flush();
    },
    [flush],
  );

  const handleContentChange = useCallback(
    (markdown: string) => {
      fieldsRef.current = { ...fieldsRef.current, content: markdown };
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(flush, 800);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const handleContentReplaced = useCallback((next: SerializedRule) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    fieldsRef.current = {
      displayName: next.displayName,
      description: next.description,
      content: next.content,
    };
    setEditorEpoch((n) => n + 1);
  }, []);

  const handleConfirmStatus = async () => {
    setStatusBusy(true);
    try {
      await dispatch(changeRuleStatus({ ruleId: rule.id, retired: !retired })).unwrap();
      setConfirmingStatus(false);
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="rule-detail">
      <PaneHeader>
        <PaneHeaderBar
          eyebrow={
            <PaneBackLink onClick={() => navigate("/agents/rules")} data-testid="rule-detail-back">
              <ArrowLeft size={14} />
              All rules
            </PaneBackLink>
          }
          icon={ListChecks}
          title={
            <InlineTextEdit
              value={rule.displayName}
              canEdit={canEdit}
              onSave={handleTitleSave}
              placeholder="Untitled rule"
              className="text-sm md:text-base font-medium text-foreground"
              testId="rule-detail-name"
            />
          }
          subtitle={
            <InlineTextEdit
              value={rule.description}
              canEdit={canEdit}
              allowEmpty
              onSave={handleDescriptionSave}
              placeholder="No description provided"
              className="text-xs text-muted-foreground"
              testId="rule-detail-description"
            />
          }
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" data-testid="rule-detail-source-chip">
              {sourceLabel(rule.source)}
            </Badge>
            {retired && <Badge variant="outline">Retired</Badge>}
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className={cn(headerChipClass, detailsOpen && headerChipActiveClass)}
              data-testid="rule-detail-metadata-toggle"
            >
              {rule.activeVersionPinned ? (
                <PushPin size={14} weight="fill" />
              ) : (
                <ClockCounterClockwise size={14} />
              )}
              v{rule.latestVersionNumber || 1}
              {detailsOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setConfirmingStatus(true)}
                className={headerButtonClass}
                aria-label={retired ? "Restore rule" : "Retire rule"}
                title={retired ? "Restore rule" : "Retire rule"}
                data-testid="rule-detail-status"
              >
                {retired ? <ArrowUUpLeft size={14} /> : <Archive size={14} />}
              </button>
            )}
          </div>
        </PaneHeaderBar>
      </PaneHeader>

      {detailsOpen && (
        <div
          className="border-b border-border px-6 py-4 max-h-[50%] overflow-y-auto"
          data-testid="rule-detail-metadata"
        >
          <div className="space-y-4">
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>Identifier</p>
              <p className="text-sm font-mono text-foreground" data-testid="rule-detail-slug">
                {rule.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Fixed at creation. Rename the rule from its title.
              </p>
            </div>
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>Where it applies</p>
              <p className="text-sm text-foreground">
                Appended to the system prompt of every agent that enables it, and to every agent
                when enabled for the organization.
              </p>
            </div>
            <RuleVersionHistory
              rule={rule}
              canEdit={canEdit}
              onContentReplaced={handleContentReplaced}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-card" data-testid="rule-detail-editor">
        <CrepeEditor
          key={`${rule.id}:${editorEpoch}`}
          contentType={ContentType.AGENT}
          contentId={rule.id}
          value={rule.content}
          onChange={canEdit ? handleContentChange : undefined}
          readonly={!canEdit}
          enableUpload={false}
          enableComments={false}
          allowImages={false}
          placeholder={RULE_EDITOR_PLACEHOLDER}
        />
      </div>

      {(isBundled || retired) && (
        <div className="px-6 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {isBundled
              ? "Bundled rules ship with Uniffy and cannot be edited or retired."
              : "Retired rules cannot be newly enabled. Agents that already use this rule keep it until it is removed."}
          </p>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingStatus}
        onClose={() => setConfirmingStatus(false)}
        onConfirm={handleConfirmStatus}
        title={retired ? "Restore rule" : "Retire rule"}
        message={
          retired ? (
            <>
              Restore <span className="font-medium text-foreground">{rule.displayName}</span>?
              Builders can enable it again for agents and for the organization.
            </>
          ) : (
            <>
              Retire <span className="font-medium text-foreground">{rule.displayName}</span>? It can
              no longer be newly enabled. Agents that already use it keep it until it is removed.
            </>
          )
        }
        confirmLabel={retired ? "Restore" : "Retire"}
        variant={retired ? "warning" : "danger"}
        loading={statusBusy}
      />
    </div>
  );
}

// A rule needs a title and instructions before it can exist, so edits stay
// local until the explicit save creates the row and its first version.
function NewRuleDetail() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const rules = useAppSelector((s) => s.agentRules.rules);

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);

  const takenSlugs = useMemo(() => Object.values(rules).map((r) => r.name), [rules]);
  const slug = deriveSkillSlug(displayName.trim(), takenSlugs, "rule");
  const canSave = displayName.trim().length > 0 && content.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await dispatch(
        saveRule({
          name: slug,
          displayName: displayName.trim(),
          description: description.trim(),
          content: content.trim(),
        }),
      ).unwrap();
      navigate(`/agents/rules/${saved.id}`, { replace: true });
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="rule-detail">
      <PaneHeader>
        <PaneHeaderBar
          icon={ListChecks}
          title={
            <InlineTextEdit
              value={displayName}
              canEdit
              onSave={setDisplayName}
              startEditing
              placeholder="Untitled rule"
              className="text-sm md:text-base font-medium text-foreground"
              testId="rule-detail-name"
            />
          }
          subtitle={
            <InlineTextEdit
              value={description}
              canEdit
              allowEmpty
              onSave={setDescription}
              placeholder="Add a description"
              className="text-xs text-muted-foreground"
              testId="rule-detail-description"
            />
          }
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={headerChipClass}>New rule</span>
            <button
              type="button"
              onClick={() => navigate("/agents/rules")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50 px-2"
              data-testid="rule-detail-discard"
            >
              <Trash size={14} />
              Discard
            </button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              data-testid="rule-detail-save"
            >
              {saving ? "Saving..." : "Save rule"}
            </Button>
          </div>
        </PaneHeaderBar>
      </PaneHeader>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className="flex items-center gap-1.5 px-6 py-2 border-b border-border text-left"
        data-testid="rule-detail-metadata-toggle"
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
          data-testid="rule-detail-metadata"
        >
          <div className="space-y-4">
            <div className="border-b border-border pb-3 space-y-1">
              <p className={sectionLabelClass}>Identifier</p>
              <p className="text-sm font-mono text-foreground" data-testid="rule-detail-slug">
                {slug}
              </p>
              <p className="text-xs text-muted-foreground">
                Derived from the title and fixed once saved.
              </p>
            </div>
            <div className="space-y-1">
              <p className={sectionLabelClass}>Where it applies</p>
              <p className="text-sm text-muted-foreground">
                Saving creates the rule without enabling it. Turn it on per agent under
                Capabilities, or for every agent from the rules list.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-card" data-testid="rule-detail-editor">
        <CrepeEditor
          contentType={ContentType.AGENT}
          contentId=""
          value={content}
          onChange={setContent}
          enableUpload={false}
          enableComments={false}
          allowImages={false}
          placeholder={RULE_EDITOR_PLACEHOLDER}
        />
      </div>
    </div>
  );
}

export function RuleDetail({ rule }: { rule?: SerializedRule }) {
  if (rule) return <SavedRuleDetail key={rule.id} rule={rule} />;
  return <NewRuleDetail />;
}
