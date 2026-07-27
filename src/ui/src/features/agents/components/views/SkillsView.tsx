import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleNotch, Lightning, Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { selectSkillById, selectSkillsLoading } from "@/features/agents/store/agentSkillsSlice";
import { fetchSkills } from "@/features/agents/store/agentSkillsThunks";
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
        return (
            <div
                className="flex h-full flex-1 items-center justify-center px-4"
                data-testid="skills-empty-state"
            >
                <div className="flex flex-col items-center text-center max-w-md">
                    <Lightning size={48} weight="light" className="text-muted-foreground/30 mb-4" />
                    <h2 className="text-lg font-semibold text-foreground">Select a skill</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Skills are reusable markdown instructions your agents load on demand. Pick
                        one from the sidebar to view or edit it.
                    </p>
                    <Button
                        onClick={onNewSkill}
                        disabled={creatingSkill}
                        className="mt-5"
                        data-testid="skills-new-skill"
                    >
                        <Plus size={16} className="mr-1" />
                        {creatingSkill ? "Creating..." : "New skill"}
                    </Button>
                </div>
            </div>
        );
    }

    if (subId === "drafts") {
        if (!panel) return <SkillDraftsInbox />;
        return <DraftPane draftId={panel} />;
    }

    return <SkillPane skillId={subId} />;
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
