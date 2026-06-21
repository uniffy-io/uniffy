import { useState } from 'react';
import { Lightning, Check, X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { SkillDraftEditorModal } from '@/features/agents/components/skills/SkillDraftEditorModal';
import type { SerializedSkillDraft } from '@/features/agents/store/agentSkillDraftsThunks';

// Inline review card for a skill the agent proposed during the conversation.
// It stays in the thread after the turn so the user can review whenever; the
// draft is never active until saved.
export function ProposedSkillDraftCard({ draft }: { draft: SerializedSkillDraft }) {
    const [editing, setEditing] = useState(false);

    const title = draft.displayName || draft.name || 'Proposed skill';
    const isEdit = draft.kind !== 'create';

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
                            {isEdit ? 'skill update' : 'new skill'}
                        </span>
                    </div>
                    {draft.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                            {draft.description}
                        </p>
                    )}

                    {draft.status === 'pending' ? (
                        <div className="mt-2 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                Review &amp; save
                            </button>
                        </div>
                    ) : (
                        <div
                            className={cn(
                                'mt-2 inline-flex items-center gap-1 text-xs',
                                draft.status === 'saved' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                            )}
                        >
                            {draft.status === 'saved' ? <Check size={14} /> : <X size={14} />}
                            {draft.status === 'saved' ? 'Saved to your skills' : 'Discarded'}
                        </div>
                    )}
                </div>
            </div>

            {editing && (
                <SkillDraftEditorModal draft={draft} onClose={() => setEditing(false)} />
            )}
        </div>
    );
}
