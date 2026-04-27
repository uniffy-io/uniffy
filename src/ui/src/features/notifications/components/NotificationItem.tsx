/**
 * Single notification item rendered in the notification panel.
 *
 * Displays actor avatar via SubjectAvatar with type icon badge overlay,
 * notification content with URN type color accent, source URN context,
 * and hover actions. CALENDAR_INVITE notifications include inline RSVP buttons.
 */

import { useState } from 'react';
import {
    Check,
    Trash,
    ShareNetwork,
    At,
    PencilSimple,
    Bell,
    CalendarPlus,
    CalendarCheck,
    ShieldCheck,
    ShieldSlash,
    Megaphone,
    ListChecks,
    ClockCountdown,
    Warning,
    ChatCircle,
    ChatCenteredText,
    UserPlus,
    UserMinus,
    ArrowBendUpLeft,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { parseUrn } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { getUrnTypeTheme } from '@/config/theme/urnColors';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { SUBJECT_TYPE } from '@/components/subject/types';
import { updateAttendeeStatus } from '@/features/calendar/store/calendarThunks';
import { markNotificationAsRead } from '@/features/notifications/store/notificationsSlice';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { NotificationType } from '@uniffy/proto/notifications/v1/notifications_pb';
import type { AttendeeStatus } from '@/features/calendar/types';
import { UrnType } from '@/shared/utils/urnTypes';
import { formatSmartDateTime } from '@/shared/utils/dateFormatting';
import { MentionChipCompact } from '@/components/mention/MentionChip';

interface NotificationTypeConfig {
    icon: Icon;
    label: string;
    color: string;
    bgColor: string;
}

const NOTIFICATION_TYPE_CONFIG: Record<number, NotificationTypeConfig> = {
    [NotificationType.CONTENT_SHARED]: {
        icon: ShareNetwork,
        label: 'Shared',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500',
    },
    [NotificationType.CONTENT_MENTIONED]: {
        icon: At,
        label: 'Mentioned',
        color: 'text-primary',
        bgColor: 'bg-primary',
    },
    [NotificationType.CONTENT_EDITED]: {
        icon: PencilSimple,
        label: 'Edited',
        color: 'text-amber-400',
        bgColor: 'bg-amber-500',
    },
    [NotificationType.CALENDAR_REMINDER]: {
        icon: Bell,
        label: 'Reminder',
        color: 'text-rose-400',
        bgColor: 'bg-rose-500',
    },
    [NotificationType.CALENDAR_INVITE]: {
        icon: CalendarPlus,
        label: 'Invite',
        color: 'text-rose-400',
        bgColor: 'bg-rose-500',
    },
    [NotificationType.CALENDAR_RESPONSE]: {
        icon: CalendarCheck,
        label: 'Response',
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500',
    },
    [NotificationType.PERMISSION_GRANTED]: {
        icon: ShieldCheck,
        label: 'Access granted',
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500',
    },
    [NotificationType.PERMISSION_REVOKED]: {
        icon: ShieldSlash,
        label: 'Access revoked',
        color: 'text-red-400',
        bgColor: 'bg-red-500',
    },
    [NotificationType.SYSTEM_ANNOUNCEMENT]: {
        icon: Megaphone,
        label: 'System',
        color: 'text-violet-400',
        bgColor: 'bg-violet-500',
    },
    [NotificationType.TASK_ASSIGNED]: {
        icon: ListChecks,
        label: 'Assigned',
        color: 'text-teal-400',
        bgColor: 'bg-teal-500',
    },
    [NotificationType.TASK_DUE_SOON]: {
        icon: ClockCountdown,
        label: 'Due soon',
        color: 'text-amber-400',
        bgColor: 'bg-amber-500',
    },
    [NotificationType.TASK_OVERDUE]: {
        icon: Warning,
        label: 'Overdue',
        color: 'text-red-400',
        bgColor: 'bg-red-500',
    },
    [NotificationType.CHAT_MENTION]: {
        icon: ChatCircle,
        label: 'Mention',
        color: 'text-violet-400',
        bgColor: 'bg-violet-500',
    },
    [NotificationType.CHAT_DM]: {
        icon: ChatCenteredText,
        label: 'Message',
        color: 'text-violet-400',
        bgColor: 'bg-violet-500',
    },
    [NotificationType.CHAT_CHANNEL_INVITE]: {
        icon: UserPlus,
        label: 'Channel invite',
        color: 'text-violet-400',
        bgColor: 'bg-violet-500',
    },
    [NotificationType.CHAT_CHANNEL_REMOVED]: {
        icon: UserMinus,
        label: 'Removed',
        color: 'text-red-400',
        bgColor: 'bg-red-500',
    },
    [NotificationType.CHAT_THREAD_REPLY]: {
        icon: ArrowBendUpLeft,
        label: 'Thread reply',
        color: 'text-violet-400',
        bgColor: 'bg-violet-500',
    },
};

const MENTION_REGEX = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

function NotificationBody({ text }: { text: string }) {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    const regex = new RegExp(MENTION_REGEX.source, 'g');

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const label = match[1];
        const urn = match[2];
        parts.push(
            <MentionChipCompact
                key={`${urn}-${match.index}`}
                urn={urn}
                label={label}
            />
        );
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return <>{parts}</>;
}

const DEFAULT_TYPE_CONFIG: NotificationTypeConfig = {
    icon: Bell,
    label: 'Notification',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
};

interface NotificationItemProps {
    notification: SerializedNotification;
    onMarkAsRead: (id: string) => void;
    onDelete: (id: string) => void;
    onClick?: (notification: SerializedNotification) => void;
    hideRowBackground?: boolean;
}

export function NotificationItem({
    notification,
    onMarkAsRead,
    onDelete,
    onClick,
    hideRowBackground = false,
}: NotificationItemProps) {
    const dispatch = useAppDispatch();
    const typeConfig = NOTIFICATION_TYPE_CONFIG[notification.notificationType] ?? DEFAULT_TYPE_CONFIG;
    const TypeIcon = typeConfig.icon;
    const [rsvpStatus, setRsvpStatus] = useState<AttendeeStatus | null>(null);

    const isCalendarInvite = notification.notificationType === NotificationType.CALENDAR_INVITE;
    const inviteParsedUrn = isCalendarInvite && notification.sourceUrn
        ? parseUrn(notification.sourceUrn)
        : null;
    const canRsvp = isCalendarInvite && inviteParsedUrn?.isValid && inviteParsedUrn.type === UrnType.CALENDAR_EVENT;

    const handleRsvp = async (status: AttendeeStatus) => {
        if (!inviteParsedUrn?.isValid) return;
        setRsvpStatus(status);
        await dispatch(updateAttendeeStatus({
            eventId: inviteParsedUrn.id,
            status,
        }));
        dispatch(markNotificationAsRead(notification.id));
    };

    const parsedUrn = notification.sourceUrn ? parseUrn(notification.sourceUrn) : null;
    const sourceConfig = parsedUrn?.isValid ? getContentTypeConfig(parsedUrn.type) : null;
    const sourceTheme = parsedUrn?.isValid ? getUrnTypeTheme(parsedUrn.type) : null;
    const SourceIcon = sourceConfig?.icon;

    const actorSubject = notification.actorId
        ? {
              id: notification.actorId,
              type: SUBJECT_TYPE.USER,
              name: notification.actorName || '',
              avatarUrl: notification.actorAvatarUrl || undefined,
          }
        : null;

    return (
        <div
            className={cn(
                'group relative flex gap-3 py-3 transition-colors cursor-pointer',
                hideRowBackground
                    ? 'px-3'
                    : cn(
                        'px-4',
                        notification.isRead
                            ? 'hover:bg-muted/30'
                            : 'bg-primary/10 hover:bg-primary/15',
                    ),
            )}
            onClick={() => onClick?.(notification)}
        >
            {!notification.isRead && !hideRowBackground && (
                <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
            )}

            <div className="relative shrink-0 mt-0.5">
                {actorSubject ? (
                    <SubjectAvatar subject={actorSubject} size="md" />
                ) : (
                    <div className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-full',
                        'bg-muted text-muted-foreground'
                    )}>
                        <TypeIcon size={16} weight="duotone" />
                    </div>
                )}

                {notification.actorName && (
                    <span className={cn(
                        'absolute -bottom-0.5 -right-0.5 flex items-center justify-center',
                        'w-4 h-4 rounded-full border-2 border-card',
                        typeConfig.bgColor,
                    )}>
                        <TypeIcon size={9} weight="bold" className="text-white" />
                    </span>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className={cn(
                    'text-[13px] leading-snug',
                    notification.isRead
                        ? 'text-muted-foreground'
                        : 'text-foreground font-medium'
                )}>
                    {notification.actorName && (
                        <span className={cn(
                            notification.isRead ? 'font-medium text-foreground/60' : 'font-semibold text-foreground'
                        )}>
                            {notification.actorName}{' '}
                        </span>
                    )}
                    {notification.title}
                </p>

                {notification.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        <NotificationBody text={notification.body} />
                    </p>
                )}

                <div className="flex items-center gap-2 mt-1.5">
                    {sourceConfig && SourceIcon && sourceTheme && (
                        <span className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                            sourceTheme.badgeBg,
                            sourceTheme.accentText,
                        )}>
                            <SourceIcon size={10} weight="fill" />
                            {sourceConfig.label}
                        </span>
                    )}
                    <span className="text-[11px] text-muted-foreground/70">
                        {formatSmartDateTime(notification.createdAt)}
                    </span>
                </div>

                {canRsvp && (
                    <div className="mt-2">
                        {rsvpStatus ? (
                            <span className="text-xs text-muted-foreground">
                                {rsvpStatus === 'accepted' && 'Accepted'}
                                {rsvpStatus === 'tentative' && 'Tentatively accepted'}
                                {rsvpStatus === 'declined' && 'Declined'}
                            </span>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRsvp('accepted');
                                    }}
                                    className="px-2.5 py-1 text-xs font-medium rounded-md status-success hover:opacity-80 transition-colors"
                                >
                                    Accept
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRsvp('tentative');
                                    }}
                                    className="px-2.5 py-1 text-xs font-medium rounded-md status-warning hover:opacity-80 transition-colors"
                                >
                                    Maybe
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRsvp('declined');
                                    }}
                                    className="px-2.5 py-1 text-xs font-medium rounded-md status-error hover:opacity-80 transition-colors"
                                >
                                    Decline
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className={cn(
                'flex items-start gap-0.5 pt-0.5 shrink-0',
                'opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity'
            )}>
                {!notification.isRead && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onMarkAsRead(notification.id);
                        }}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Mark as read"
                    >
                        <Check size={13} weight="bold" />
                    </button>
                )}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(notification.id);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover-destructive transition-colors"
                    title="Delete"
                >
                    <Trash size={13} />
                </button>
            </div>
        </div>
    );
}
