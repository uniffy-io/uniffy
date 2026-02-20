/**
 * Notification bell icon for the app header.
 * Shows unread count badge and opens the notification panel.
 */

import { useRef } from 'react';
import { Bell } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { useUnreadCountPolling } from '@/features/notifications/hooks/useNotifications';
import { useNotificationStream } from '@/features/notifications/hooks/useNotificationStream';
import { usePushSubscription } from '@/features/notifications/hooks/usePushSubscription';
import { NotificationPanel } from '@/features/notifications/components/NotificationPanel';

export function NotificationBell() {
    const { panelOpen, toggle, close } = useNotifications();
    const unreadCount = useUnreadCountPolling();
    const bellRef = useRef<HTMLDivElement>(null);

    // Start real-time streaming
    useNotificationStream();

    // Keep push subscription active (re-subscribes if permission granted but no subscription)
    usePushSubscription();

    return (
        <div className="relative" ref={bellRef}>
            <button
                onClick={toggle}
                className={cn(
                    'group relative flex items-center justify-center py-1.5 px-1.5 rounded-lg',
                    'transition-all duration-500 ease-out overflow-hidden',
                    'focus:outline-none'
                )}
            >
                {/* Hover/Active background */}
                <span
                    className={cn(
                        'absolute inset-0 rounded-lg transition-all duration-500',
                        panelOpen ? 'bg-primary/10' : 'bg-transparent'
                    )}
                />

                {/* Hover underline effect */}
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

                {/* Icon */}
                <span className={cn(
                    'relative z-10 flex items-center justify-center w-7 h-7 rounded-md',
                    'transition-all duration-500 ease-out',
                    panelOpen
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground group-hover:text-primary'
                )}>
                    <Bell size={20} weight={panelOpen ? 'fill' : 'duotone'} />
                </span>

                {/* Unread badge */}
                {unreadCount > 0 && (
                    <span className={cn(
                        'absolute top-0.5 right-0.5 z-20 flex items-center justify-center',
                        'min-w-[16px] h-4 px-1 rounded-full',
                        'text-white text-[10px] font-bold leading-none'
                    )} style={{ backgroundColor: 'var(--status-error)' }}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {panelOpen && <NotificationPanel onClose={close} />}
        </div>
    );
}
