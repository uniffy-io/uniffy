import { Fragment, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Lightning, Plus, Sparkle, Trash } from "@phosphor-icons/react";
import { SkillSource } from "@uniffy/proto/agents/v1/skills_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BrowseBody,
  BrowseCard,
  BrowseEmpty,
  BrowseGrid,
  BrowseGroupLabel,
  BrowseHeader,
  BrowsePaneMessage,
  BrowsePaneSpinner,
} from "@/features/agents/components/browse/BrowseSurface";
import {
  selectAllSkills,
  selectSkillById,
  selectSkillsLoading,
} from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills, type SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import {
  selectDraftById,
  selectDraftsLoading,
  selectInboxDrafts,
} from "@/features/agents/store/agentSkillDraftsSlice";
import {
  discardSkillDraft,
  fetchSkillDraft,
  fetchSkillDrafts,
  type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";
import { SkillDetail } from "@/features/agents/components/views/SkillDetail";

interface SkillsViewProps {
  onNewSkill: () => void;
  creatingSkill: boolean;
}

export function SkillsView({ onNewSkill, creatingSkill }: SkillsViewProps) {
  const dispatch = useAppDispatch();
  const { subId, panel } = useParams<{ subId?: string; panel?: string }>();

  useEffect(() => {
    dispatch(fetchSkills());
    dispatch(fetchSkillDrafts({ status: "pending" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!subId) {
    return <SkillsBrowse onNewSkill={onNewSkill} creatingSkill={creatingSkill} />;
  }

  // Pending drafts browse alongside saved skills; only a draft's editor has its
  // own route, so a bare /drafts link lands on the grid.
  if (subId === "drafts") {
    if (!panel) return <Navigate to="/agents/skills" replace />;
    return <DraftPane draftId={panel} />;
  }

  return <SkillPane skillId={subId} />;
}

const SKILL_GROUPS = [
  { source: SkillSource.ORGANIZATION, label: "Organization" },
  { source: SkillSource.BUNDLED, label: "Bundled" },
] as const;

function draftKindLabel(kind: string): string {
  if (kind === "edit") return "Edit";
  if (kind === "evolve") return "Improvement";
  return "New skill";
}

function SkillCard({ skill, onOpen }: { skill: SerializedSkill; onOpen: () => void }) {
  return (
    <BrowseCard
      onOpen={onOpen}
      testId={`skills-card-${skill.id}`}
      leading={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Lightning size={18} weight="duotone" />
        </span>
      }
      title={skill.displayName || skill.name}
      subtitle={skill.description || "No description"}
      chips={
        <Badge variant="secondary" className="font-mono text-[10px] font-medium">
          {skill.name}
        </Badge>
      }
    />
  );
}

function DraftCard({
  draft,
  onOpen,
  onDiscard,
  discarding,
}: {
  draft: SerializedSkillDraft;
  onOpen: () => void;
  onDiscard: () => void;
  discarding: boolean;
}) {
  const fromAgent = Boolean(draft.proposedByAgentId);
  const isEdit = draft.kind !== "create";
  return (
    <BrowseCard
      onOpen={onOpen}
      testId={`skills-draft-card-${draft.id}`}
      leading={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary">
          <Lightning size={18} weight="duotone" />
        </span>
      }
      title={draft.displayName || draft.name || "Untitled skill"}
      subtitle={draft.rationale || draft.description || "No description"}
      badges={
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
          {draftKindLabel(draft.kind)}
        </Badge>
      }
      chips={
        <>
          {isEdit && draft.name && (
            <Badge variant="secondary" className="font-mono text-[10px] font-medium">
              {draft.name}
            </Badge>
          )}
          {fromAgent ? (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Sparkle size={12} weight="fill" />
              Proposed by agent
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Your draft</span>
          )}
        </>
      }
      footer={
        <>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            Review and save
            <ArrowRight size={13} />
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            disabled={discarding}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-50"
            data-testid={`skills-draft-discard-${draft.id}`}
          >
            <Trash size={13} />
            {discarding ? "Discarding..." : "Discard"}
          </button>
        </>
      }
    />
  );
}

function SkillsBrowse({
  onNewSkill,
  creatingSkill,
}: {
  onNewSkill: () => void;
  creatingSkill: boolean;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const skillsMap = useAppSelector(selectAllSkills);
  const skillsLoading = useAppSelector(selectSkillsLoading);
  const pendingDrafts = useAppSelector(selectInboxDrafts);
  const draftsLoading = useAppSelector(selectDraftsLoading);
  const [search, setSearch] = useState("");
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const skills = Object.values(skillsMap).filter((skill) => {
    const label = skill.displayName || skill.name;
    return !query || label.toLowerCase().includes(query);
  });
  const drafts = pendingDrafts.filter((draft) => {
    const label = draft.displayName || draft.name || "";
    return !query || label.toLowerCase().includes(query);
  });

  const handleDiscard = async (draftId: string) => {
    setDiscardingId(draftId);
    try {
      await dispatch(discardSkillDraft(draftId)).unwrap();
    } finally {
      setDiscardingId(null);
    }
  };

  const loading = (skillsLoading || draftsLoading) && skills.length === 0 && drafts.length === 0;
  const empty = skills.length === 0 && drafts.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skills-browse">
      <BrowseHeader
        icon={Lightning}
        title="Skills"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search skills..."
        testId="skills-browse-header"
        action={
          <Button onClick={onNewSkill} disabled={creatingSkill} data-testid="skills-new-skill">
            <Plus size={16} />
            {creatingSkill ? "Creating..." : "New skill"}
          </Button>
        }
      />
      <BrowseBody testId="skills-browse-body">
        {empty ? (
          <BrowseEmpty
            icon={Lightning}
            title={query ? "No match" : loading ? "Loading skills..." : "No skills yet"}
            description={
              query
                ? `No skill matches "${search.trim()}".`
                : "A skill is a markdown snippet an agent loads when it needs it."
            }
            testId="skills-browse-empty"
          />
        ) : (
          <>
            {drafts.length > 0 && (
              <>
                <BrowseGroupLabel>Drafts to review</BrowseGroupLabel>
                <BrowseGrid>
                  {drafts.map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      discarding={discardingId === draft.id}
                      onOpen={() => navigate(`/agents/skills/drafts/${draft.id}`)}
                      onDiscard={() => void handleDiscard(draft.id)}
                    />
                  ))}
                </BrowseGrid>
              </>
            )}
            {SKILL_GROUPS.map(({ source, label }) => {
              const group = skills.filter((skill) => skill.source === source);
              if (group.length === 0) return null;
              return (
                <Fragment key={source}>
                  <BrowseGroupLabel>{label}</BrowseGroupLabel>
                  <BrowseGrid>
                    {group.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        onOpen={() => navigate(`/agents/skills/${skill.id}`)}
                      />
                    ))}
                  </BrowseGrid>
                </Fragment>
              );
            })}
          </>
        )}
      </BrowseBody>
    </div>
  );
}

function SkillPane({ skillId }: { skillId: string }) {
  const skill = useAppSelector(selectSkillById(skillId));
  const loading = useAppSelector(selectSkillsLoading);

  if (skill) return <SkillDetail skill={skill} />;
  if (loading) return <BrowsePaneSpinner />;
  return (
    <BrowsePaneMessage
      icon={Lightning}
      title="Skill not found"
      description="This skill no longer exists or you do not have access to it."
    />
  );
}

function DraftPane({ draftId }: { draftId: string }) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectDraftById(draftId));
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (draft) return;
    let cancelled = false;
    dispatch(fetchSkillDraft(draftId))
      .unwrap()
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, draftId, draft]);

  if (draft?.status === "pending") return <SkillDetail draft={draft} />;
  if (draft) {
    return (
      <BrowsePaneMessage
        icon={Lightning}
        title="Draft already handled"
        description={
          draft.status === "saved"
            ? "This draft has been saved as a skill."
            : "This draft has been discarded."
        }
      />
    );
  }
  if (fetchFailed) {
    return (
      <BrowsePaneMessage
        icon={Lightning}
        title="Draft not found"
        description="This draft no longer exists. It may have been saved or discarded."
      />
    );
  }
  return <BrowsePaneSpinner />;
}
