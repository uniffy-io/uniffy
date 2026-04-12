import { ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { cn } from '@/shared/utils/cn';
import { roleLabel } from '@/shared/utils/contentRoles';

interface ContentRoleBadgeProps {
    role: ContentRole | number | null | undefined;
    className?: string;
}

const ROLE_CLASS: Record<number, string> = {
    [ContentRole.OWNER]: 'bg-primary/10 text-primary',
    [ContentRole.ADMIN]: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    [ContentRole.EDITOR]: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    [ContentRole.COMMENTER]: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    [ContentRole.VIEWER]: 'bg-muted text-muted-foreground',
    [ContentRole.BLOCKED]: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export function ContentRoleBadge({ role, className }: ContentRoleBadgeProps) {
    const cls = role != null ? ROLE_CLASS[role] ?? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground';
    return (
        <span
            className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                cls,
                className,
            )}
        >
            {roleLabel(role)}
        </span>
    );
}
