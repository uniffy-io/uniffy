import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CircleNotch, PencilSimple, Sparkle, Trash } from "@phosphor-icons/react";
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
} from "@/features/agents/store/agentSkillDraftsThunks";

function kindLabel(kind: string): string {
  if (kind === "edit") return "Edit";
  if (kind === "evolve") return "Improvement";
  return "New skill";
}

export function SkillDraftsInbox() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const drafts = useAppSelector(selectInboxDrafts);
  const loading = useAppSelector(selectDraftsLoading);

  useEffect(() => {
    dispatch(fetchSkillDrafts({ status: "pending" }));
  }, [dispatch]);

  const handleDiscard = (draftId: string) => {
    dispatch(discardSkillDraft(draftId));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="skills-drafts-list">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-xl font-semibold text-foreground">Drafts</h2>
        <p className="text-sm text-muted-foreground">Skill proposals waiting for review</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && drafts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <CircleNotch size={28} className="animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkle size={48} weight="light" className="text-muted-foreground/30 mb-4" />
            <p className="text-lg font-semibold text-foreground">No drafts to review</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Skill suggestions from your agents and your own drafts land here for review before
              anything is saved.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => {
              const fromAgent = Boolean(draft.proposedByAgentId);
              return (
                <div
                  key={draft.id}
                  onClick={() => navigate(`/agents/skills/drafts/${draft.id}`)}
                  className="flex cursor-pointer flex-col gap-2 rounded-xl bg-card p-4 shadow-edge transition-shadow duration-150 hover:shadow-edge-strong"
                  data-testid="skills-draft-row"
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
                    <p className="text-xs text-muted-foreground line-clamp-2">{draft.rationale}</p>
                  )}

                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/agents/skills/drafts/${draft.id}`)}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscard(draft.id);
                      }}
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
        )}
      </div>
    </div>
  );
}
