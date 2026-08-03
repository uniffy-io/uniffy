import { useState, useCallback } from 'react';
import { TreeStructure } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';

// Avoid repeated requests for avatar URLs that already 404'd.
const _failedAvatars = new Set<string>();
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import { SUBJECT_TYPE, type Subject, type SubjectAvatarSize } from '@/components/subject/types';
import { getAvatarGradientStyle, getInitials } from '@/components/subject/utils';
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

const TEAM_ICON_SIZES: Record<SubjectAvatarSize, number> = {
    xs: 10,
    sm: 12,
    md: 16,
    lg: 20,
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
    const sizeClass = SIZE_CLASSES[size];
    const resolvedAvatarUrl = useAvatarUrl(
        subject.type === SUBJECT_TYPE.USER ? subject.id : '',
        size === 'lg' ? 'md' : 'sm',
    );
    const avatarSrc = subject.avatarUrl || resolvedAvatarUrl || null;
    const [imgFailed, setImgFailed] = useState(() => !!avatarSrc && _failedAvatars.has(avatarSrc));
    const handleImgError = useCallback(() => {
        if (avatarSrc) _failedAvatars.add(avatarSrc);
        setImgFailed(true);
    }, [avatarSrc]);
    const presenceStatus = usePresence(
        showPresence && subject.type === SUBJECT_TYPE.USER ? subject.id : '',
    );
    const shouldShowPresence =
        showPresence && subject.type === SUBJECT_TYPE.USER;

    if (subject.type === SUBJECT_TYPE.GROUP) {
        if (subject.kind === 'team') {
            return (
                <div
                    className={cn(
                        'rounded-full flex items-center justify-center shrink-0',
                        'bg-primary/15 text-primary',
                        sizeClass,
                        bordered && 'border-2 border-card',
                        className
                    )}
                    title={subject.name}
                >
                    <TreeStructure size={TEAM_ICON_SIZES[size]} weight="duotone" />
                </div>
            );
        }
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

    const avatarElement = avatarSrc && !imgFailed ? (
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
            onError={handleImgError}
        />
    ) : (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium text-white',
                sizeClass,
                bordered && 'border-2 border-card',
                !shouldShowPresence && className
            )}
            style={getAvatarGradientStyle(subject.name || subject.id)}
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

interface SubjectAvatarByIdProps {
    userId: string;
    displayName?: string;
    /** Server-built avatar URL (e.g. a chat message's senderAvatarUrl). When
     *  set it wins over the id-derived lookup, which only covers users. */
    avatarUrl?: string;
    size?: SubjectAvatarSize;
    className?: string;
    bordered?: boolean;
    /** Show presence indicator dot. */
    showPresence?: boolean;
}

export function SubjectAvatarById({
    userId,
    displayName,
    avatarUrl,
    size = 'sm',
    className,
    bordered = false,
    showPresence = false,
}: SubjectAvatarByIdProps) {
    const sizeClass = SIZE_CLASSES[size];
    const resolvedUrl = useAvatarUrl(userId, size === 'lg' ? 'md' : 'sm');
    const avatarSrc = avatarUrl || resolvedUrl;
    const [imgFailed, setImgFailed] = useState(() => !!avatarSrc && _failedAvatars.has(avatarSrc));
    const handleImgError = useCallback(() => {
        if (avatarSrc) _failedAvatars.add(avatarSrc);
        setImgFailed(true);
    }, [avatarSrc]);
    const presenceStatus = usePresence(showPresence ? userId : '');

    const avatarElement = avatarSrc && !imgFailed ? (
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
            onError={handleImgError}
        />
    ) : (
        <div
            className={cn(
                'rounded-full flex items-center justify-center shrink-0 font-medium text-white',
                sizeClass,
                bordered && 'border-2 border-card',
                !showPresence && className
            )}
            style={getAvatarGradientStyle(displayName || userId)}
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
