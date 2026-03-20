import { useState } from 'react';
import { SubjectPicker, subjectToShareTarget, type Subject } from '@/components/subject';
import { PermissionLevel } from '@uniffy/proto/common/v1/common_pb';
import { PermissionLevelSelect } from '@/features/sharing/components/PermissionLevelSelect';
import type { SerializedShareTarget } from '@/features/sharing/store/sharingSlice';

interface ShareTargetSearchProps {
    onSelect: (target: SerializedShareTarget, level: number) => void;
    existingSubjectIds: string[];
    disabled?: boolean;
    allowedLevels?: number[];
}

export function ShareTargetSearch({
    onSelect,
    existingSubjectIds,
    disabled = false,
    allowedLevels,
}: ShareTargetSearchProps) {
    const [selectedLevel, setSelectedLevel] = useState<number>(PermissionLevel.VIEW);
    const [isOpen, setIsOpen] = useState(false);

    const handleChange = (_ids: string[], subjects: Subject[]) => {
        const subject = subjects[0];
        if (!subject) return;
        if (!existingSubjectIds.includes(subject.id)) {
            onSelect(subjectToShareTarget(subject), selectedLevel);
        }
    };

    return (
        <div className="flex gap-2">
            <div className="relative flex-1">
                {isOpen ? (
                    <SubjectPicker
                        mode="single"
                        subjectTypes="all"
                        value={existingSubjectIds}
                        onChange={handleChange}
                        onClose={() => setIsOpen(false)}
                        placeholder="Search users or groups..."
                        disabled={disabled}
                        autoFocus
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsOpen(true)}
                        disabled={disabled}
                        className="w-full pl-3 pr-4 py-2 rounded-md bg-muted border border-border text-sm text-muted-foreground text-left hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Search users or groups...
                    </button>
                )}
            </div>
            <div className="w-32">
                <PermissionLevelSelect
                    value={selectedLevel}
                    onChange={setSelectedLevel}
                    disabled={disabled}
                    allowedLevels={allowedLevels}
                />
            </div>
        </div>
    );
}
