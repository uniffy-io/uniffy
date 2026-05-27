import { useState } from 'react';
import { Crown } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { SubjectPicker } from '@/components/subject';
import { DomainType } from '@uniffy/proto/common/v1/common_pb';
import type { Subject } from '@/components/subject/types';

const DOMAIN_OPTIONS: SelectOption<number>[] = [
    { value: DomainType.CHAT, label: 'Chat' },
    { value: DomainType.FILES, label: 'Files' },
    { value: DomainType.NOTES, label: 'Notes' },
    { value: DomainType.CALENDAR, label: 'Calendar' },
    { value: DomainType.PROJECTS, label: 'Projects' },
    { value: DomainType.AGENTS, label: 'Agents' },
];

interface GrantDomainAdminDialogProps {
    open: boolean;
    onClose: () => void;
    onGrant: (userId: string, domain: number) => Promise<void>;
    preselectedDomain?: number;
}

export function GrantDomainAdminDialog({
    open,
    onClose,
    onGrant,
    preselectedDomain,
}: GrantDomainAdminDialogProps) {
    const [selectedUser, setSelectedUser] = useState<Subject | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selectedDomain, setSelectedDomain] = useState<number>(
        preselectedDomain ?? DomainType.CHAT,
    );
    const [submitting, setSubmitting] = useState(false);
    const [showPicker, setShowPicker] = useState(false);

    const handleGrant = async () => {
        if (!selectedUser) return;
        setSubmitting(true);
        try {
            await onGrant(selectedUser.id, selectedDomain);
            handleClose();
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        setSelectedUser(null);
        setSelectedIds([]);
        setSelectedDomain(preselectedDomain ?? DomainType.CHAT);
        setShowPicker(false);
        onClose();
    };

    if (!open) return null;

    return (
        <Modal onClose={handleClose}>
            <div className="w-[calc(100vw-2rem)] max-w-md">
                <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Crown className="h-5 w-5 text-primary" weight="duotone" />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">Grant Domain Admin</h2>
                </div>

                <div className="space-y-4 px-5 py-4">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">User</label>
                        {selectedUser ? (
                            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2">
                                <div>
                                    <p className="text-sm font-medium text-foreground">{selectedUser.name}</p>
                                    <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setSelectedUser(null);
                                        setSelectedIds([]);
                                        setShowPicker(false);
                                    }}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Change
                                </button>
                            </div>
                        ) : (
                            <div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowPicker(!showPicker)}
                                    className="w-full justify-start text-muted-foreground"
                                >
                                    Select a user...
                                </Button>
                                {showPicker && (
                                    <div className="mt-2">
                                        <SubjectPicker
                                            mode="single"
                                            subjectTypes="users"
                                            value={selectedIds}
                                            onChange={(ids, subjects) => {
                                                setSelectedIds(ids);
                                                if (subjects.length > 0) {
                                                    setSelectedUser(subjects[0]);
                                                    setShowPicker(false);
                                                }
                                            }}
                                            autoFocus
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Domain</label>
                        <Select
                            value={selectedDomain}
                            onChange={setSelectedDomain}
                            options={DOMAIN_OPTIONS}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                    <Button variant="ghost" onClick={handleClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleGrant}
                        disabled={!selectedUser || submitting}
                    >
                        {submitting ? 'Granting...' : 'Grant Admin'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
