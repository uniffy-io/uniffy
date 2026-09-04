import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CircleNotch, Lightning, Plus, Tray } from "@phosphor-icons/react";
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
} from "@/features/agents/components/browse/BrowseSurface";
import {
  selectAllSkills,
  selectSkillById,
  selectSkillsLoading,
} from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills, type SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { selectInboxCount } from "@/features/agents/store/agentSkillDraftsSlice";
import { selectDraftById } from "@/features/agents/store/agentSkillDraftsSlice";
import { fetchSkillDraft, fetchSkillDrafts } from "@/features/agents/store/agentSkillDraftsThunks";
import { SkillDraftsInbox } from "@/features/agents/components/skills/SkillDraftsInbox";
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

  if (subId === "drafts") {
    if (!panel) return <SkillDraftsInbox />;
    return <DraftPane draftId={panel} />;
  }

  return <SkillPane skillId={subId} />;
}

const SKILL_GROUPS = [
  { source: SkillSource.ORGANIZATION, label: "Organization" },
  { source: SkillSource.BUNDLED, label: "Bundled" },
] as const;

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
      badges={
        skill.alwaysActive ? (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
            always on
          </Badge>
        ) : undefined
      }
      chips={
        <Badge variant="secondary" className="font-mono text-[10px] font-medium">
          {skill.name}
        </Badge>
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
  const navigate = useNavigate();
  const skillsMap = useAppSelector(selectAllSkills);
  const draftCount = useAppSelector(selectInboxCount);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const skills = Object.values(skillsMap).filter((skill) => {
    const label = skill.displayName || skill.name;
    return !query || label.toLowerCase().includes(query);
  });

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
          <div className="flex items-center gap-2">
            {draftCount > 0 && (
              <Button
                variant="outline"
                onClick={() => navigate("/agents/skills/drafts")}
                data-testid="skills-browse-drafts-button"
              >
                <Tray size={16} />
                {draftCount} draft{draftCount === 1 ? "" : "s"}
              </Button>
            )}
            <Button onClick={onNewSkill} disabled={creatingSkill} data-testid="skills-new-skill">
              <Plus size={16} />
              {creatingSkill ? "Creating..." : "New skill"}
            </Button>
          </div>
        }
      />
      <BrowseBody testId="skills-browse-body">
        {skills.length === 0 ? (
          <BrowseEmpty
            icon={Lightning}
            title={query ? "No match" : "No skills yet"}
            description={
              query
                ? `No skill matches "${search.trim()}".`
                : "A skill is a markdown snippet an agent loads when it needs it."
            }
            testId="skills-browse-empty"
          />
        ) : (
          SKILL_GROUPS.map(({ source, label }) => {
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
          })
        )}
      </BrowseBody>
    </div>
  );
}

function PaneSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <CircleNotch size={32} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function PaneMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <Lightning size={48} weight="light" className="text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

function SkillPane({ skillId }: { skillId: string }) {
  const skill = useAppSelector(selectSkillById(skillId));
  const loading = useAppSelector(selectSkillsLoading);

  if (skill) return <SkillDetail skill={skill} />;
  if (loading) return <PaneSpinner />;
  return (
    <PaneMessage
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
      <PaneMessage
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
      <PaneMessage
        title="Draft not found"
        description="This draft no longer exists. It may have been saved or discarded."
      />
    );
  }
  return <PaneSpinner />;
}
