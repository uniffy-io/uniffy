import { useRef, useState } from 'react';
import { ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { Plus, Clock } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SubjectPicker } from '@/components/subject/SubjectPicker';
import { type Subject } from '@/components/subject/types';
import { ContentRoleSelect } from '@/features/permissions/components/ContentRoleSelect';

interface AddMemberPopoverProps {
    existingSubjectIds: string[];
    onAdd: (subject: Subject, role: ContentRole, expiresAt?: Date) => Promise<void> | void;
    disabled?: boolean;
}

export function AddMemberPopover({ existingSubjectIds, onAdd, disabled }: AddMemberPopoverProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [role, setRole] = useState<ContentRole>(ContentRole.VIEWER);
    const [showExpiry, setShowExpiry] = useState(false);
    const [expiryValue, setExpiryValue] = useState('');
    const anchorRef = useRef<HTMLDivElement>(null);

    const handleSelect = async (_ids: string[], subjects: Subject[]) => {
        const subject = subjects[0];
        if (!subject) return;
        const expiresAt = showExpiry && expiryValue ? new Date(expiryValue) : undefined;
        await onAdd(subject, role, expiresAt);
        setIsOpen(false);
        setShowExpiry(false);
        setExpiryValue('');
    };

    const [minDate] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16));

    return (
        <div ref={anchorRef} className="space-y-2">
            <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setIsOpen((v) => !v)} disabled={disabled}>
                    <Plus size={16} weight="bold" />
                    Add people or groups
                </Button>
                <ContentRoleSelect
                    value={role}
                    onChange={setRole}
                    excludeRoles={[ContentRole.OWNER, ContentRole.BLOCKED, ContentRole.UNSPECIFIED]}
                    size="sm"
                />
                <button
                    type="button"
                    onClick={() => setShowExpiry((v) => !v)}
                    className={`p-1.5 rounded-md text-sm transition-colors ${
                        showExpiry
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    title="Set expiration"
                >
                    <Clock size={16} weight={showExpiry ? 'fill' : 'regular'} />
                </button>
            </div>
            {showExpiry && (
                <div className="flex items-center gap-2 pl-1">
                    <span className="text-xs text-muted-foreground">Expires:</span>
                    <input
                        type="datetime-local"
                        value={expiryValue}
                        onChange={(e) => setExpiryValue(e.target.value)}
                        min={minDate}
                        className="text-xs rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                </div>
            )}
            {isOpen && (
                <SubjectPicker
                    mode="single"
                    subjectTypes="all"
                    value={[]}
                    onChange={handleSelect}
                    excludeIds={existingSubjectIds}
                    portal
                    anchorRef={anchorRef}
                    onClose={() => setIsOpen(false)}
                    autoFocus
                    dropdownWidth={320}
                />
            )}
        </div>
    );
}
