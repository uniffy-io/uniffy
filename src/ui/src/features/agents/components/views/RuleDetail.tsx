import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  ArrowUUpLeft,
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
import { InstructionVersionHistory } from "@/features/agents/components/instruction/InstructionVersionHistory";
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

const RULE_HINT =
  "Markdown appended to the system prompt on every run of an agent that selected this rule. Type / for headings, lists, and code.";

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

function WhereItApplies({ children }: { children: React.ReactNode }) {
  return (
    <DetailField label="Where it applies">
      <p className="text-sm text-foreground">{children}</p>
    </DetailField>
  );
}

function SavedRuleDetail({ rule }: { rule: SerializedRule }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isBuilder } = useAgentsBuilderAccess();

  const isBundled = rule.source === RuleSource.BUNDLED;
  const retired = rule.status === RuleStatus.RETIRED;
  const canEdit = !isBundled && isBuilder;

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLElement | null>(null);
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

  const handleConfirmStatus = async () => {
    setStatusBusy(true);
    try {
      await dispatch(changeRuleStatus({ ruleId: rule.id, retired: !retired })).unwrap();
      setConfirmingStatus(false);
    } finally {
      setStatusBusy(false);
    }
  };

  const versionSummary = rule.activeVersionPinned
    ? "pinned to an earlier version"
    : `v${rule.latestVersionNumber || 1}, following the latest edit`;

  const footer = isBundled
    ? "Bundled rules ship with Uniffy and cannot be edited or retired."
    : retired
      ? "Retired rules cannot be newly selected. Agents that already use this rule keep it until it is removed."
      : undefined;

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
          title={rule.displayName || "Untitled rule"}
          subtitle={rule.description || undefined}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary" data-testid="rule-detail-source-chip">
              {sourceLabel(rule.source)}
            </Badge>
            {retired && <Badge variant="outline">Retired</Badge>}
            <button
              type="button"
              onClick={toggleHistory}
              className={cn(headerChipClass, historyOpen && headerChipActiveClass)}
              title="Version history"
              data-testid="rule-detail-history-chip"
            >
              {rule.activeVersionPinned ? (
                <PushPin size={14} weight="fill" />
              ) : (
                <ClockCounterClockwise size={14} />
              )}
              v{rule.latestVersionNumber || 1}
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

      <DetailBody>
        <DetailSection label="Details" testId="rule-detail-metadata">
          <DetailCard className="space-y-5">
            <DetailFieldRow>
              <DetailTextField
                key={`name:${editorEpoch}`}
                label="Title"
                value={rule.displayName}
                required
                disabled={!canEdit}
                placeholder="Untitled rule"
                onCommit={handleTitleSave}
                testId="rule-detail-name"
              />
              <DetailField label="Identifier" hint="Fixed at creation.">
                <DetailReadOnlyValue mono testId="rule-detail-slug">
                  {rule.name}
                </DetailReadOnlyValue>
              </DetailField>
            </DetailFieldRow>
            <DetailTextField
              key={`description:${editorEpoch}`}
              label="Description"
              value={rule.description}
              disabled={!canEdit}
              placeholder="What this rule is for"
              hint="Shown in the rules list and in each agent's Capabilities panel."
              onCommit={handleDescriptionSave}
              testId="rule-detail-description"
            />
            <WhereItApplies>
              Appended to the system prompt of every agent that selected it under Capabilities.
              Selecting is per agent; there is no organization-wide switch.
            </WhereItApplies>
          </DetailCard>
        </DetailSection>

        <DetailSection label="Rule" hint={RULE_HINT}>
          <DetailEditorCard testId="rule-detail-editor" footer={footer}>
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
              compact
              minHeight={DETAIL_EDITOR_MIN_HEIGHT}
              className={detailEditorClass}
              placeholder={RULE_EDITOR_PLACEHOLDER}
            />
          </DetailEditorCard>
        </DetailSection>

        <DetailToggleSection
          label="Version history"
          summary={versionSummary}
          open={historyOpen}
          onToggle={toggleHistory}
          sectionRef={historyRef}
          testId="rule-detail-history-toggle"
        >
          <DetailCard>
            <RuleVersionHistory
              rule={rule}
              canEdit={canEdit}
              onContentReplaced={handleContentReplaced}
            />
          </DetailCard>
        </DetailToggleSection>
      </DetailBody>

      <ConfirmDialog
        isOpen={confirmingStatus}
        onClose={() => setConfirmingStatus(false)}
        onConfirm={handleConfirmStatus}
        title={retired ? "Restore rule" : "Retire rule"}
        message={
          retired ? (
            <>
              Restore <span className="font-medium text-foreground">{rule.displayName}</span>?
              Builders can select it for agents again.
            </>
          ) : (
            <>
              Retire <span className="font-medium text-foreground">{rule.displayName}</span>? It can
              no longer be newly selected. Agents that already use it keep it until it is removed.
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
          eyebrow={
            <PaneBackLink onClick={() => navigate("/agents/rules")} data-testid="rule-detail-back">
              <ArrowLeft size={14} />
              All rules
            </PaneBackLink>
          }
          icon={ListChecks}
          title={displayName.trim() || "Untitled rule"}
          subtitle={description.trim() || "Not saved yet"}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={headerChipClass}>New rule</span>
            <button
              type="button"
              onClick={() => navigate("/agents/rules")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-50"
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

      <DetailBody>
        <DetailSection label="Details" testId="rule-detail-metadata">
          <DetailCard className="space-y-5">
            <DetailFieldRow>
              <DetailTextField
                label="Title"
                value={displayName}
                live
                autoFocus
                placeholder="Give the rule a name"
                onCommit={setDisplayName}
                testId="rule-detail-name"
              />
              <DetailField label="Identifier" hint="Derived from the title and fixed once saved.">
                <DetailReadOnlyValue mono testId="rule-detail-slug">
                  {slug}
                </DetailReadOnlyValue>
              </DetailField>
            </DetailFieldRow>
            <DetailTextField
              label="Description"
              value={description}
              live
              placeholder="What this rule is for"
              hint="Shown in the rules list and in each agent's Capabilities panel."
              onCommit={setDescription}
              testId="rule-detail-description"
            />
            <WhereItApplies>
              Saving creates the rule without selecting it anywhere. Turn it on per agent under
              Capabilities.
            </WhereItApplies>
          </DetailCard>
        </DetailSection>

        <DetailSection label="Rule" hint={RULE_HINT}>
          <DetailEditorCard testId="rule-detail-editor">
            <CrepeEditor
              contentType={ContentType.AGENT}
              contentId=""
              value={content}
              onChange={setContent}
              enableUpload={false}
              enableComments={false}
              allowImages={false}
              compact
              minHeight={DETAIL_EDITOR_MIN_HEIGHT}
              className={detailEditorClass}
              placeholder={RULE_EDITOR_PLACEHOLDER}
            />
          </DetailEditorCard>
        </DetailSection>
      </DetailBody>
    </div>
  );
}

export function RuleDetail({ rule }: { rule?: SerializedRule }) {
  if (rule) return <SavedRuleDetail key={rule.id} rule={rule} />;
  return <NewRuleDetail />;
}
