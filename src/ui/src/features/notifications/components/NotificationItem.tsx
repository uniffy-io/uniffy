/**
 * Single notification item rendered in the notification panel.
 *
 * Displays actor avatar with type icon overlay, notification content,
 * source URN context, and hover actions. CALENDAR_INVITE notifications
 * include inline RSVP buttons (Accept/Maybe/Decline).
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
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { parseUrn } from '@/shared/utils/urn';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { getUrnTypeTheme } from '@/config/theme/urnColors';
import { updateAttendeeStatus } from '@/features/calendar/store/calendarThunks';
import { markNotificationAsRead } from '@/features/notifications/store/notificationsSlice';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { NotificationType } from '@/gen/notifications/v1/notifications_pb';
import type { AttendeeStatus } from '@/features/calendar/types';
import { UrnType } from '@/shared/utils/urnTypes';

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
};

const DEFAULT_TYPE_CONFIG: NotificationTypeConfig = {
    icon: Bell,
    label: 'Notification',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
};

function formatRelativeTime(dateStr: string): string {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    });
}

function getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
}

interface NotificationItemProps {
    notification: SerializedNotification;
    onMarkAsRead: (id: string) => void;
    onDelete: (id: string) => void;
    onClick?: (notification: SerializedNotification) => void;
}

export function NotificationItem({
    notification,
    onMarkAsRead,
    onDelete,
    onClick,
}: NotificationItemProps) {
    const dispatch = useAppDispatch();
    const typeConfig = NOTIFICATION_TYPE_CONFIG[notification.notificationType] ?? DEFAULT_TYPE_CONFIG;
    const TypeIcon = typeConfig.icon;
    const [rsvpStatus, setRsvpStatus] = useState<AttendeeStatus | null>(null);

    // Determine if this is a calendar invite that supports RSVP
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

    // Resolve source URN for contextual display
    const parsedUrn = notification.sourceUrn ? parseUrn(notification.sourceUrn) : null;
    const sourceConfig = parsedUrn?.isValid ? getContentTypeConfig(parsedUrn.type) : null;
    const sourceTheme = parsedUrn?.isValid ? getUrnTypeTheme(parsedUrn.type) : null;
    const SourceIcon = sourceConfig?.icon;

    return (
        <div
            className={cn(
                'group relative flex gap-3 px-4 py-3 transition-colors cursor-pointer',
                'hover:bg-muted/50',
                !notification.isRead && 'bg-gradient-to-r from-primary/[0.06] to-transparent'
            )}
            onClick={() => onClick?.(notification)}
        >
            {/* Unread accent bar */}
            {!notification.isRead && (
                <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" />
            )}

            {/* Avatar with type badge */}
            <div className="relative shrink-0 mt-0.5">
                {notification.actorAvatarUrl ? (
                    <img
                        src={notification.actorAvatarUrl}
                        alt={notification.actorName}
                        className="w-8 h-8 rounded-full object-cover"
                    />
                ) : (
                    <div className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-full',
                        'bg-muted text-muted-foreground text-xs font-semibold',
                        notification.actorId && 'bg-primary/15 text-primary'
                    )}>
                        {notification.actorName
                            ? getInitials(notification.actorName)
                            : <TypeIcon size={16} weight="duotone" />
                        }
                    </div>
                )}

                {/* Type icon badge (only when avatar shows actor, not type icon) */}
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

            {/* Content */}
            <div className="flex-1 min-w-0">
                {/* Title line */}
                <p className={cn(
                    'text-[13px] leading-snug',
                    notification.isRead
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                )}>
                    {notification.actorName && (
                        <span className={cn(
                            'font-semibold',
                            notification.isRead ? 'text-foreground/70' : 'text-foreground'
                        )}>
                            {notification.actorName}{' '}
                        </span>
                    )}
                    <span className={notification.isRead ? undefined : 'text-foreground/80'}>
                        {notification.title}
                    </span>
                </p>

                {/* Body preview */}
                {notification.body && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {notification.body}
                    </p>
                )}

                {/* Meta row: source pill + time */}
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
                        {formatRelativeTime(notification.createdAt)}
                    </span>
                </div>

                {/* RSVP Buttons for Calendar Invites */}
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

            {/* Hover actions */}
            <div className={cn(
                'flex items-start gap-0.5 pt-0.5 shrink-0',
                'opacity-0 group-hover:opacity-100 transition-opacity'
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
