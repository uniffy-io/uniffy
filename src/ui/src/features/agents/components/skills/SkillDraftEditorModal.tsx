import { useState } from 'react';
import { Lightning, Trash } from '@phosphor-icons/react';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch } from '@/app/hooks';
import {
    saveSkillDraft,
    discardSkillDraft,
    type SerializedSkillDraft,
} from '@/features/agents/store/agentSkillDraftsThunks';

interface SkillDraftEditorModalProps {
    draft: SerializedSkillDraft;
    onClose: () => void;
    onSaved?: (skillId: string) => void;
    onDiscarded?: () => void;
}

// Shared review/edit surface for a pending skill draft. The reviewer's edits
// are authoritative - the full field set is sent on save, so what they see is
// exactly what the saved version captures. Used by the agent chat, the team
// chat card, and the library.
export function SkillDraftEditorModal({
    draft,
    onClose,
    onSaved,
    onDiscarded,
}: SkillDraftEditorModalProps) {
    const dispatch = useAppDispatch();
    const [name, setName] = useState(draft.name ?? '');
    const [displayName, setDisplayName] = useState(draft.displayName ?? '');
    const [description, setDescription] = useState(draft.description ?? '');
    const [whenToUse, setWhenToUse] = useState(draft.whenToUse ?? '');
    const [content, setContent] = useState(draft.content ?? '');
    const [scope, setScope] = useState(draft.suggestedScope || 'personal');
    const [alwaysActive, setAlwaysActive] = useState(draft.suggestedAlwaysActive);
    const [busy, setBusy] = useState<'save' | 'discard' | null>(null);

    const canSave = name.trim().length > 0 && displayName.trim().length > 0 && busy === null;
    const isEdit = draft.kind !== 'create';
    const fromAgent = Boolean(draft.proposedByAgentId);

    const handleSave = async () => {
        if (!canSave) return;
        setBusy('save');
        try {
            const result = await dispatch(
                saveSkillDraft({
                    draftId: draft.id,
                    fields: {
                        name: name.trim(),
                        displayName: displayName.trim(),
                        description: description.trim(),
                        content: content.trim(),
                        whenToUse: whenToUse.trim(),
                        requiresTools: draft.requiresTools,
                        requiresContext: draft.requiresContext,
                        suggestedScope: scope,
                        suggestedAlwaysActive: alwaysActive,
                    },
                }),
            ).unwrap();
            onSaved?.(result.skill.id);
            onClose();
        } catch {
            setBusy(null);
        }
    };

    const handleDiscard = async () => {
        setBusy('discard');
        try {
            await dispatch(discardSkillDraft(draft.id)).unwrap();
            onDiscarded?.();
            onClose();
        } catch {
            setBusy(null);
        }
    };

    return (
        <Modal onClose={onClose} maxWidth="max-w-2xl" closeDisabled={busy !== null}>
            <div className="flex flex-col max-h-[85vh]">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                    <Lightning size={20} weight="fill" className="text-primary shrink-0" />
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-foreground truncate">
                            {isEdit ? 'Review skill update' : 'Review proposed skill'}
                        </h2>
                        {fromAgent && (
                            <p className="text-xs text-muted-foreground">
                                Drafted by the agent - it is not active until you save it.
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                    {draft.rationale && (
                        <p className="text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
                            {draft.rationale}
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Skill name (slug)"
                            disabled={isEdit}
                            className={cn(
                                'bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                                isEdit && 'opacity-60 cursor-not-allowed',
                            )}
                        />
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Display name"
                            className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Description"
                        className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                        type="text"
                        value={whenToUse}
                        onChange={(e) => setWhenToUse(e.target.value)}
                        placeholder="When to use this skill (trigger guidance)"
                        className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <div className="border border-border rounded-lg overflow-hidden bg-muted">
                        <CrepeEditor
                            contentType={ContentType.AGENT}
                            contentId={draft.targetSkillId ?? ''}
                            value={content}
                            onChange={setContent}
                            enableUpload={false}
                            compact
                            minHeight="160px"
                            maxHeight="320px"
                            placeholder="Skill instructions (markdown)"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                        {!isEdit && (
                            <label className="flex items-center gap-2 text-sm text-foreground">
                                <span className="text-muted-foreground">Scope</span>
                                <select
                                    value={scope}
                                    onChange={(e) => setScope(e.target.value)}
                                    className="bg-muted border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                    <option value="personal">Personal</option>
                                    <option value="organization">Organization</option>
                                </select>
                            </label>
                        )}
                        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={alwaysActive}
                                onChange={(e) => setAlwaysActive(e.target.checked)}
                                className="accent-primary"
                            />
                            Always active
                        </label>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
                    <button
                        type="button"
                        onClick={handleDiscard}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                        <Trash size={16} />
                        {busy === 'discard' ? 'Discarding...' : 'Discard'}
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy !== null}
                            className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!canSave}
                            className={cn(
                                'bg-primary text-primary-foreground rounded px-4 py-1.5 text-sm transition-colors',
                                canSave ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed',
                            )}
                        >
                            {busy === 'save' ? 'Saving...' : isEdit ? 'Save new version' : 'Save skill'}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
