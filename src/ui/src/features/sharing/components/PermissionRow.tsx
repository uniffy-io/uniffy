/**
 * Permission Row Component
 *
 * Displays a single permission entry with edit/remove actions.
 */

import { useState } from 'react';
import { UsersThree, Trash, Calendar } from '@phosphor-icons/react';
import { PermissionLevelSelect } from '@/features/sharing/components/PermissionLevelSelect';
import { isUserPermission, getPermissionLevelLabel } from '@/features/sharing/hooks/useSharingHooks';
import type { SerializedPermissionInfo } from '@/features/sharing/store/sharingSlice';

interface PermissionRowProps {
    permission: SerializedPermissionInfo;
    onUpdate: (permissionId: string, level: number) => Promise<void>;
    onRemove: (permissionId: string) => Promise<void>;
    disabled?: boolean;
    canEdit?: boolean;
}

export function PermissionRow({
    permission,
    onUpdate,
    onRemove,
    disabled = false,
    canEdit = true,
}: PermissionRowProps) {
    const [isRemoving, setIsRemoving] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    const isUser = isUserPermission(permission);
    const subject = permission.subject;

    if (!subject) {
        return null;
    }

    const handleLevelChange = async (newLevel: number) => {
        if (newLevel === permission.level) return;
        setIsUpdating(true);
        try {
            await onUpdate(permission.id, newLevel);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleRemove = async () => {
        setIsRemoving(true);
        try {
            await onRemove(permission.id);
        } catch {
            setIsRemoving(false);
        }
    };

    // Format expiration date
    const formatExpiration = () => {
        if (!permission.expiresAt) return null;
        const date = new Date(Number(permission.expiresAt.seconds) * 1000);
        const now = new Date();
        const isExpired = date < now;

        return (
            <span
                className={`text-xs flex items-center gap-1 ${
                    isExpired ? '' : 'text-muted-foreground'
                }`}
                style={isExpired ? { color: 'var(--status-error)' } : undefined}
            >
                <Calendar size={12} />
                {isExpired ? 'Expired' : `Until ${date.toLocaleDateString()}`}
            </span>
        );
    };

    // Get initials for avatar
    const getInitials = (name: string): string => {
        return name
            .split(' ')
            .map((part) => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div
            className={`
                flex items-center gap-3 py-3 px-3 rounded-lg
                ${disabled || isRemoving ? 'opacity-50' : ''}
                hover:bg-muted/50 transition-colors group
            `}
        >
            {/* Avatar/Icon */}
            <div
                className={`
                    w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                    ${isUser ? 'bg-emerald-500/10' : 'bg-violet-500/10'}
                `}
            >
                {isUser ? (
                    subject.avatarUrl ? (
                        <img
                            src={subject.avatarUrl}
                            alt={subject.name}
                            className="w-full h-full rounded-full object-cover"
                        />
                    ) : (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            {getInitials(subject.name)}
                        </span>
                    )
                ) : (
                    <UsersThree size={16} className="text-violet-600 dark:text-violet-400" />
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{subject.name}</p>
                    <span
                        className={`
                            text-xs px-1.5 py-0.5 rounded
                            ${
                                isUser
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                            }
                        `}
                    >
                        {isUser ? 'User' : 'Group'}
                    </span>
                </div>
                {isUser && subject.email && (
                    <p className="text-xs text-muted-foreground truncate">{subject.email}</p>
                )}
                {!isUser && subject.memberCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {subject.memberCount} member{subject.memberCount !== 1 ? 's' : ''}
                    </p>
                )}
                {formatExpiration()}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                {canEdit ? (
                    <>
                        <PermissionLevelSelect
                            value={permission.level}
                            onChange={handleLevelChange}
                            disabled={disabled || isRemoving || isUpdating}
                            compact
                        />
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={disabled || isRemoving}
                            className="p-1.5 rounded-md text-muted-foreground hover-destructive
                                transition-colors
                                opacity-0 group-hover:opacity-100
                                disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Remove access"
                        >
                            <Trash size={16} />
                        </button>
                    </>
                ) : (
                    <span className="text-sm text-muted-foreground">
                        {getPermissionLevelLabel(permission.level)}
                    </span>
                )}
            </div>
        </div>
    );
}

