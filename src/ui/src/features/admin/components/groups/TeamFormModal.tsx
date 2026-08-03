import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/config/errorMessages';
import { Select, type SelectOption } from '@/components/ui/select';
import type { SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SubjectAvatarById } from '@/components/subject/SubjectAvatar';
import { SubjectPicker } from '@/components/subject/SubjectPicker';
import { useSubjectResolver } from '@/components/subject';

export interface TeamFormValues {
    name: string;
    description: string;
    leadUserId?: string;
    parentGroupId?: string;
    clearLead?: boolean;
    clearParentGroup?: boolean;
}

interface TeamFormModalProps {
    team?: SerializedGroupInfo | null;
    allTeams: SerializedGroupInfo[];
    onSave: (values: TeamFormValues) => Promise<void>;
    onClose: () => void;
}

export function TeamFormModal({ team, allTeams, onSave, onClose }: TeamFormModalProps) {
    const [name, setName] = useState(team?.name || '');
    const [description, setDescription] = useState(team?.description || '');
    const [leadUserId, setLeadUserId] = useState<string | null>(team?.leadUserId ?? null);
    const [parentGroupId, setParentGroupId] = useState<string>(team?.parentGroupId ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { subjects: leadSubjects } = useSubjectResolver(leadUserId ? [leadUserId] : []);
    const leadSubject = leadSubjects[0];

    const parentOptions: SelectOption[] = [
        { value: '', label: 'No parent team' },
        ...allTeams
            .filter((t) => t.id !== team?.id)
            .map((t) => ({ value: t.id, label: t.name })),
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            await onSave({
                name: name.trim(),
                description: description.trim(),
                leadUserId: leadUserId ?? undefined,
                parentGroupId: parentGroupId || undefined,
                clearLead: Boolean(team?.leadUserId && !leadUserId),
                clearParentGroup: Boolean(team?.parentGroupId && !parentGroupId),
            });
            onClose();
        } catch (err) {
            // unwrap() rejects with a SerializedError plain object, not an Error.
            const raw = (err as { message?: string })?.message ?? String(err);
            setError(friendlyErrorMessage(raw) || 'Failed to save team');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
            <div className="w-full sm:w-[calc(100vw-2rem)] sm:max-w-md bg-card rounded-t-xl sm:rounded-xl border border-border shadow-xl">
                <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
                    <h2 className="text-lg font-semibold">{team ? 'Edit Team' : 'Create Team'}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {error && <div className="p-3 rounded-md text-sm status-error">{error}</div>}

                    <div>
                        <label className="block text-sm font-medium mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Engineering"
                            className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional description..."
                            rows={3}
                            className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Team lead</label>
                        {leadUserId ? (
                            <div className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2">
                                <SubjectAvatarById
                                    userId={leadUserId}
                                    displayName={leadSubject?.name}
                                    size="sm"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">
                                    {leadSubject?.name ?? leadUserId.slice(-6)}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setLeadUserId(null)}
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    aria-label="Clear team lead"
                                >
                                    <X size={14} weight="bold" />
                                </button>
                            </div>
                        ) : (
                            <SubjectPicker
                                mode="single"
                                subjectTypes="users"
                                value={[]}
                                onChange={(_ids, subjects) => {
                                    const subject = subjects[0];
                                    if (subject) setLeadUserId(subject.id);
                                }}
                                placeholder="Search for a lead..."
                            />
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Parent team</label>
                        <Select
                            value={parentGroupId}
                            onChange={setParentGroupId}
                            options={parentOptions}
                            ariaLabel="Parent team"
                            menuMinWidth={200}
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="ghost" size="md" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" size="md" loading={saving} disabled={saving}>
                            {saving ? 'Saving...' : team ? 'Save Changes' : 'Create Team'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
