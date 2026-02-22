/**
 * SubjectAvatar - Avatar circle for users and groups
 *
 * Users: tries loading photo via buildAvatarUrl, falls back to accent-colored initials circle.
 * Groups: violet initials circle derived from group name.
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { buildAvatarUrl } from '@/shared/utils/fileUrls';
import { SUBJECT_TYPE, type Subject, type SubjectAvatarSize } from '@/components/subject/types';
import { getInitials } from '@/components/subject/utils';

const SIZE_CLASSES: Record<SubjectAvatarSize, string> = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
};

interface SubjectAvatarProps {
    subject: Subject;
    size?: SubjectAvatarSize;
    className?: string;
    /** Show border (useful in stacked layouts). */
    bordered?: boolean;
}

export function SubjectAvatar({
    subject,
    size = 'sm',
    className,
    bordered = false,
}: SubjectAvatarProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const sizeClass = SIZE_CLASSES[size];

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

    // User with photo
    if (!imgFailed) {
        return (
            <img
                src={buildAvatarUrl(subject.id, 'sm')}
                alt={subject.name}
                className={cn(
                    'rounded-full object-cover shrink-0',
                    sizeClass,
                    bordered && 'border-2 border-card',
                    className
                )}
                title={subject.name}
                onError={() => setImgFailed(true)}
            />
        );
    }

    // User fallback: accent initials
    const initials = getInitials(subject.name || subject.id.slice(-2));
    return (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium',
                'bg-primary/15 text-primary',
                sizeClass,
                bordered && 'border-2 border-card',
                className
            )}
            title={subject.name}
        >
            {initials}
        </div>
    );
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
}

export function SubjectAvatarById({
    userId,
    displayName,
    size = 'sm',
    className,
    bordered = false,
}: SubjectAvatarByIdProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const sizeClass = SIZE_CLASSES[size];

    if (!imgFailed) {
        return (
            <img
                src={buildAvatarUrl(userId, 'sm')}
                alt={displayName || userId}
                className={cn(
                    'rounded-full object-cover shrink-0',
                    sizeClass,
                    bordered && 'border-2 border-card',
                    className
                )}
                title={displayName}
                onError={() => setImgFailed(true)}
            />
        );
    }

    const initials = displayName
        ? getInitials(displayName)
        : userId.slice(-2).toUpperCase();

    return (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium',
                'bg-primary/15 text-primary',
                sizeClass,
                bordered && 'border-2 border-card',
                className
            )}
            title={displayName}
        >
            {initials}
        </div>
    );
}
