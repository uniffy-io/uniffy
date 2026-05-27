import { cn } from '@/shared/utils/cn';
import { type SubjectAvatarSize } from '@/components/subject/types';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';

const OVERFLOW_SIZE_CLASSES: Record<SubjectAvatarSize, string> = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
};

interface SubjectAvatarStackProps {
    subjectIds: string[];
    /** Max avatars to show before "+N". Default: 3. */
    maxDisplay?: number;
    size?: SubjectAvatarSize;
    className?: string;
}

export function SubjectAvatarStack({
    subjectIds,
    maxDisplay = 3,
    size = 'sm',
    className,
}: SubjectAvatarStackProps) {
    const { subjects } = useSubjectResolver(subjectIds);

    if (subjects.length === 0) return null;

    const visible = subjects.slice(0, maxDisplay);
    const overflow = subjects.length - maxDisplay;

    return (
        <div className={cn('flex -space-x-1.5', className)}>
            {visible.map((subject) => (
                <SubjectAvatar
                    key={subject.id}
                    subject={subject}
                    size={size}
                    bordered
                />
            ))}
            {overflow > 0 && (
                <div
                    className={cn(
                        'rounded-full bg-muted flex items-center justify-center font-medium text-muted-foreground border-2 border-card shrink-0',
                        OVERFLOW_SIZE_CLASSES[size]
                    )}
                >
                    +{overflow}
                </div>
            )}
        </div>
    );
}
