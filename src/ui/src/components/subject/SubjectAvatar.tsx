/**
 * SubjectAvatar - Avatar circle for users and groups
 *
 * Users: tries loading photo via buildAvatarUrl, falls back to accent-colored initials circle.
 * Groups: violet initials circle derived from group name.
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import { SUBJECT_TYPE, type Subject, type SubjectAvatarSize } from '@/components/subject/types';
import { getInitials } from '@/components/subject/utils';
import { usePresence } from '@/features/presence/hooks/usePresence';

const SIZE_CLASSES: Record<SubjectAvatarSize, string> = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
};

const INDICATOR_SIZE_MAP: Record<SubjectAvatarSize, 'sm' | 'md' | 'lg'> = {
    xs: 'sm',
    sm: 'sm',
    md: 'md',
    lg: 'lg',
};

interface SubjectAvatarProps {
    subject: Subject;
    size?: SubjectAvatarSize;
    className?: string;
    /** Show border (useful in stacked layouts). */
    bordered?: boolean;
    /** Show presence indicator dot (users only). */
    showPresence?: boolean;
}

export function SubjectAvatar({
    subject,
    size = 'sm',
    className,
    bordered = false,
    showPresence = false,
}: SubjectAvatarProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const sizeClass = SIZE_CLASSES[size];
    const resolvedAvatarUrl = useAvatarUrl(
        subject.type === SUBJECT_TYPE.USER ? subject.id : '',
        size === 'lg' ? 'md' : 'sm',
    );
    const avatarSrc = subject.avatarUrl || resolvedAvatarUrl;
    const presenceStatus = usePresence(
        showPresence && subject.type === SUBJECT_TYPE.USER ? subject.id : '',
    );
    const shouldShowPresence =
        showPresence && subject.type === SUBJECT_TYPE.USER;

    if (subject.type === SUBJECT_TYPE.GROUP) {
        const groupInitials = getInitials(subject.name || subject.id.slice(0, 2));
        return (
            <div
                className={cn(
                    'rounded-full flex items-center justify-center shrink-0 font-medium',
                    'bg-violet-500/15 text-violet-700 dark:text-violet-400',
                    sizeClass,
                    bordered && 'border-2 border-card',
                    className
                )}
                title={subject.name}
            >
                {groupInitials}
            </div>
        );
    }

    // User avatar element (photo or initials fallback)
    const avatarElement = !imgFailed ? (
        <img
            src={avatarSrc}
            alt={subject.name}
            className={cn(
                'rounded-full object-cover shrink-0',
                sizeClass,
                bordered && 'border-2 border-card',
                !shouldShowPresence && className
            )}
            title={subject.name}
            onError={() => setImgFailed(true)}
        />
    ) : (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium',
                'bg-primary/15 text-primary',
                sizeClass,
                bordered && 'border-2 border-card',
                !shouldShowPresence && className
            )}
            title={subject.name}
        >
            {getInitials(subject.name || subject.id.slice(-2))}
        </div>
    );

    if (shouldShowPresence) {
        return (
            <div className={cn('relative inline-flex shrink-0', className)}>
                {avatarElement}
                <PresenceIndicator
                    status={presenceStatus}
                    size={INDICATOR_SIZE_MAP[size]}
                />
            </div>
        );
    }

    return avatarElement;
}

/**
 * Minimal avatar rendering by ID alone when no Subject object is available.
 * Shows initials from a display name or truncated ID.
 */
interface SubjectAvatarByIdProps {
    userId: string;
    displayName?: string;
    size?: SubjectAvatarSize;
    className?: string;
    bordered?: boolean;
    /** Show presence indicator dot. */
    showPresence?: boolean;
}

export function SubjectAvatarById({
    userId,
    displayName,
    size = 'sm',
    className,
    bordered = false,
    showPresence = false,
}: SubjectAvatarByIdProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const sizeClass = SIZE_CLASSES[size];
    const avatarSrc = useAvatarUrl(userId, size === 'lg' ? 'md' : 'sm');
    const presenceStatus = usePresence(showPresence ? userId : '');

    const avatarElement = !imgFailed ? (
        <img
            src={avatarSrc}
            alt={displayName || userId}
            className={cn(
                'rounded-full object-cover shrink-0',
                sizeClass,
                bordered && 'border-2 border-card',
                !showPresence && className
            )}
            title={displayName}
            onError={() => setImgFailed(true)}
        />
    ) : (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium',
                'bg-primary/15 text-primary',
                sizeClass,
                bordered && 'border-2 border-card',
                !showPresence && className
            )}
            title={displayName}
        >
            {displayName ? getInitials(displayName) : userId.slice(-2).toUpperCase()}
        </div>
    );

    if (showPresence) {
        return (
            <div className={cn('relative inline-flex shrink-0', className)}>
                {avatarElement}
                <PresenceIndicator
                    status={presenceStatus}
                    size={INDICATOR_SIZE_MAP[size]}
                />
            </div>
        );
    }

    return avatarElement;
}
