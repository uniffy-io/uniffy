import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lightning, Check, X, Trash } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { discardSkillDraft } from "@/features/agents/store/agentSkillDraftsThunks";
import type { SerializedSkillDraft } from "@/features/agents/store/agentSkillDraftsThunks";

// Inline review card for a skill the agent proposed during the conversation.
// It stays in the thread after the turn so the user can review whenever; the
// draft is never active until saved.
export function ProposedSkillDraftCard({ draft }: { draft: SerializedSkillDraft }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [discarding, setDiscarding] = useState(false);

  const title = draft.displayName || draft.name || "Proposed skill";
  const isEdit = draft.kind !== "create";

  const handleDiscard = async () => {
    setDiscarding(true);
    try {
      await dispatch(discardSkillDraft(draft.id)).unwrap();
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div
      className="my-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3"
      data-testid="proposed-skill-draft-card"
    >
      <div className="flex items-start gap-3">
        <Lightning size={18} weight="fill" className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{title}</span>
            <span className="text-xs text-muted-foreground">
              {isEdit ? "skill update" : "new skill"}
            </span>
          </div>
          {draft.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{draft.description}</p>
          )}

          {draft.status === "pending" ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/agents/skills/drafts/${draft.id}`)}
                disabled={discarding}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Review &amp; save
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={discarding}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
              >
                <Trash size={13} />
                Discard
              </button>
            </div>
          ) : (
            <div
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs",
                draft.status === "saved"
                  ? "text-green-600 dark:text-green-400"
                  : "text-muted-foreground",
              )}
            >
              {draft.status === "saved" ? <Check size={14} /> : <X size={14} />}
              {draft.status === "saved" ? "Saved to your skills" : "Discarded"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
