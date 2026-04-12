import { ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { X, Clock } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import { SUBJECT_TYPE } from '@/components/subject/types';
import { ContentRoleSelect } from '@/features/permissions/components/ContentRoleSelect';
import { formatDateFull } from '@/shared/utils/dateFormatting';
import type { SerializedContentMember } from '@/features/permissions/store/permissionsSlice';

interface MemberRowProps {
    member: SerializedContentMember;
    canEdit: boolean;
    onUpdate: (newRole: ContentRole) => Promise<void> | void;
    onRemove: () => Promise<void> | void;
    blocked?: boolean;
}

export function MemberRow({ member, canEdit, onUpdate, onRemove, blocked }: MemberRowProps) {
    const { subjects } = useSubjectResolver([member.subjectId]);
    const subject = subjects[0];
    const isGroup = member.subjectType === SUBJECT_TYPE.GROUP;

    return (
        <div
            className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40',
                blocked && 'opacity-70',
            )}
        >
            <SubjectAvatar subject={subject} size="md" />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                    {subject?.name ?? member.subjectId.slice(-6)}
                </div>
                {!isGroup && subject?.email && (
                    <div className="text-xs text-muted-foreground truncate">{subject.email}</div>
                )}
                {isGroup && (
                    <div className="text-xs text-muted-foreground">Group</div>
                )}
                {member.expiresAt && (
                    <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <Clock size={12} />
                        Expires {formatDateFull(new Date(Number(member.expiresAt.seconds) * 1000).toISOString())}
                    </div>
                )}
            </div>
            {!blocked && (
                <ContentRoleSelect
                    value={member.role}
                    onChange={(role) => onUpdate(role)}
                    excludeRoles={[ContentRole.OWNER, ContentRole.UNSPECIFIED]}
                    disabled={!canEdit}
                    size="sm"
                />
            )}
            {canEdit && (
                <button
                    type="button"
                    onClick={() => onRemove()}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label={blocked ? 'Unblock' : 'Remove'}
                >
                    <X size={16} weight="bold" />
                </button>
            )}
        </div>
    );
}
