import { useRef } from 'react';
import { Bell } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { useUnreadCountPolling } from '@/features/notifications/hooks/useNotifications';
import { usePushSubscription } from '@/features/notifications/hooks/usePushSubscription';
import { NotificationPanel } from '@/features/notifications/components/NotificationPanel';

export function NotificationBell() {
    const { panelOpen, toggle, close } = useNotifications();
    const unreadCount = useUnreadCountPolling();
    const bellRef = useRef<HTMLDivElement>(null);

    usePushSubscription();

    return (
        <div className="relative" ref={bellRef}>
            <button
                onClick={toggle}
                className={cn(
                    'relative flex items-center justify-center w-7 h-7 rounded-md',
                    'border border-border transition-colors duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    panelOpen
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'text-muted-foreground hover:text-primary hover:border-border'
                )}
            >
                <Bell size={20} weight={panelOpen ? 'fill' : 'duotone'} />

                {unreadCount > 0 && (
                    <span
                        className={cn(
                            'absolute -top-1 -right-1 z-20 flex items-center justify-center',
                            'min-w-[16px] h-4 px-1 rounded-full',
                            'text-white text-[10px] font-bold leading-none'
                        )}
                        style={{ backgroundColor: 'var(--status-error)' }}
                    >
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {panelOpen && <NotificationPanel onClose={close} anchorRef={bellRef} />}
        </div>
    );
}
