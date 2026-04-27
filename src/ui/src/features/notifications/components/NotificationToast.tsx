/**
 * Custom toast content component for real-time notification alerts.
 *
 * Renders a rich notification toast with actor avatar, type color accent,
 * title, truncated body, and click-to-navigate behavior.
 * Respects Zen Mode by being suppressed when active.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from '@phosphor-icons/react';
import {
    Bell,
    ShareNetwork,
    At,
    PencilSimple,
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
import { toast } from 'sonner';
import { cn } from '@/shared/utils/cn';
import { parseUrn, urnToPath } from '@/shared/utils/urn';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { SUBJECT_TYPE } from '@/components/subject/types';
import { getUrnTypeTheme } from '@/config/theme/urnColors';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { NotificationType } from '@uniffy/proto/notifications/v1/notifications_pb';

const TYPE_ICON_MAP: Record<number, Icon> = {
    [NotificationType.CONTENT_SHARED]: ShareNetwork,
    [NotificationType.CONTENT_MENTIONED]: At,
    [NotificationType.CONTENT_EDITED]: PencilSimple,
    [NotificationType.CALENDAR_REMINDER]: Bell,
    [NotificationType.CALENDAR_INVITE]: CalendarPlus,
    [NotificationType.CALENDAR_RESPONSE]: CalendarCheck,
    [NotificationType.PERMISSION_GRANTED]: ShieldCheck,
    [NotificationType.PERMISSION_REVOKED]: ShieldSlash,
    [NotificationType.SYSTEM_ANNOUNCEMENT]: Megaphone,
    [NotificationType.TASK_ASSIGNED]: ListChecks,
    [NotificationType.TASK_DUE_SOON]: ClockCountdown,
    [NotificationType.TASK_OVERDUE]: Warning,
    [NotificationType.CHAT_MENTION]: ChatCircle,
    [NotificationType.CHAT_DM]: ChatCenteredText,
    [NotificationType.CHAT_CHANNEL_INVITE]: UserPlus,
    [NotificationType.CHAT_CHANNEL_REMOVED]: UserMinus,
    [NotificationType.CHAT_THREAD_REPLY]: ArrowBendUpLeft,
};

interface NotificationToastProps {
    notification: SerializedNotification;
    toastId: string | number;
    onMarkAsRead: (id: string) => void;
}

export function NotificationToast({
    notification,
    toastId,
    onMarkAsRead,
}: NotificationToastProps) {
    const navigate = useNavigate();
    const TypeIcon = TYPE_ICON_MAP[notification.notificationType] ?? Bell;

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

    const handleClick = useCallback(() => {
        onMarkAsRead(notification.id);
        toast.dismiss(toastId);

        if (notification.sourceUrn) {
            const parsed = parseUrn(notification.sourceUrn);
            if (parsed) {
                const path = urnToPath(notification.sourceUrn);
                if (path) {
                    navigate(path);
                }
            }
        }
    }, [notification, toastId, onMarkAsRead, navigate]);

    const handleDismiss = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        toast.dismiss(toastId);
    }, [toastId]);

    return (
        <div
            onClick={handleClick}
            className={cn(
                'flex items-start gap-3 w-[360px] p-3 rounded-lg cursor-pointer',
                'bg-card border border-border shadow-lg',
                'hover:bg-muted/30 transition-colors'
            )}
        >
            <div className="relative shrink-0 mt-0.5">
                {actorSubject ? (
                    <SubjectAvatar subject={actorSubject} size="md" />
                ) : (
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground">
                        <TypeIcon size={16} weight="duotone" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-[13px] leading-snug text-foreground">
                    {notification.actorName && (
                        <span className="font-semibold">{notification.actorName} </span>
                    )}
                    <span className="text-foreground/80">{notification.title}</span>
                </p>
                {notification.body && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {notification.body}
                    </p>
                )}
                {sourceConfig && SourceIcon && sourceTheme && (
                    <span className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium mt-1',
                        sourceTheme.badgeBg,
                        sourceTheme.accentText,
                    )}>
                        <SourceIcon size={10} weight="fill" />
                        {sourceConfig.label}
                    </span>
                )}
            </div>

            <button
                onClick={handleDismiss}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground shrink-0 transition-colors"
            >
                <X size={12} weight="bold" />
            </button>
        </div>
    );
}
