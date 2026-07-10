import { useEffect, useState } from "react";
import { CircleNotch, Sparkle, PencilSimple, Trash, ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Badge } from "@/components/ui/badge";
import {
    selectInboxDrafts,
    selectDraftsLoading,
} from "@/features/agents/store/agentSkillDraftsSlice";
import {
    fetchSkillDrafts,
    discardSkillDraft,
    type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";
import { SkillDraftEditorModal } from "@/features/agents/components/skills/SkillDraftEditorModal";

interface SkillDraftsInboxProps {
    onSkillSaved?: () => void;
}

function kindLabel(kind: string): string {
    if (kind === "edit") return "Edit";
    if (kind === "evolve") return "Improvement";
    return "New skill";
}

export function SkillDraftsInbox({ onSkillSaved }: SkillDraftsInboxProps) {
    const dispatch = useAppDispatch();
    const drafts = useAppSelector(selectInboxDrafts);
    const loading = useAppSelector(selectDraftsLoading);
    const [reviewing, setReviewing] = useState<SerializedSkillDraft | null>(null);

    useEffect(() => {
        dispatch(fetchSkillDrafts({ status: "pending" }));
    }, [dispatch]);

    const handleDiscard = (draftId: string) => {
        dispatch(discardSkillDraft(draftId));
    };

    if (loading && drafts.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <CircleNotch size={28} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (drafts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <Sparkle size={28} className="text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">No drafts to review</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Skill suggestions from your agents and your own drafts land here for review
                    before anything is saved.
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-3">
                {drafts.map((draft) => {
                    const fromAgent = Boolean(draft.proposedByAgentId);
                    return (
                        <div
                            key={draft.id}
                            className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2"
                        >
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">
                                    {draft.displayName || draft.name || "Untitled skill"}
                                </span>
                                <Badge variant="outline">{kindLabel(draft.kind)}</Badge>
                                {fromAgent ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                                        <Sparkle size={12} weight="fill" />
                                        Proposed by agent
                                    </span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">Your draft</span>
                                )}
                            </div>

                            {draft.rationale && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                    {draft.rationale}
                                </p>
                            )}
                            {draft.whenToUse && (
                                <p className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">When: </span>
                                    {draft.whenToUse}
                                </p>
                            )}

                            <div className="flex items-center gap-3 mt-1">
                                <button
                                    type="button"
                                    onClick={() => setReviewing(draft)}
                                    className={cn(
                                        "inline-flex items-center gap-1 text-xs font-medium",
                                        "text-primary hover:underline",
                                    )}
                                >
                                    <PencilSimple size={13} />
                                    Review and save
                                    <ArrowRight size={13} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDiscard(draft.id)}
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <Trash size={13} />
                                    Discard
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {reviewing && (
                <SkillDraftEditorModal
                    draft={reviewing}
                    onClose={() => setReviewing(null)}
                    onSaved={() => {
                        setReviewing(null);
                        onSkillSaved?.();
                    }}
                />
            )}
        </>
    );
}
