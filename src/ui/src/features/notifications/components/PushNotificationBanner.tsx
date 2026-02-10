/**
 * Shows on every login until the user either subscribes or dismisses.
 * Dismissed state persists for the session only (sessionStorage),
 * so it reappears on next login.
 */

import { useCallback, useReducer } from 'react';
import { Bell, X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { usePushSubscription } from '@/features/notifications/hooks/usePushSubscription';

const DISMISSED_KEY = 'uniffy_push_dismissed';

type BannerState = { visible: boolean; subscribing: boolean };
type BannerAction =
    | { type: 'hide' }
    | { type: 'start_subscribe' }
    | { type: 'end_subscribe'; success: boolean };

function bannerReducer(state: BannerState, action: BannerAction): BannerState {
    switch (action.type) {
        case 'hide':
            return { ...state, visible: false };
        case 'start_subscribe':
            return { ...state, subscribing: true };
        case 'end_subscribe':
            return { visible: !action.success, subscribing: false };
    }
}

/**
 * Compute initial banner visibility synchronously (no setState in effect).
 */
function getInitialVisibility(isSupported: boolean): boolean {
    if (!isSupported) return false;
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'denied') return false;
    if (sessionStorage.getItem(DISMISSED_KEY) === 'true') return false;
    // For 'granted' users we still show the banner -- they might not have a subscription.
    // The subscribe() call is idempotent and will just re-register.
    // For 'default' users we always show it.
    return true;
}

export function PushNotificationBanner() {
    const { subscribe, isSupported } = usePushSubscription();
    const [state, dispatch] = useReducer(bannerReducer, isSupported, (supported) => ({
        visible: getInitialVisibility(supported),
        subscribing: false,
    }));

    const handleEnable = useCallback(async () => {
        dispatch({ type: 'start_subscribe' });
        const success = await subscribe();
        dispatch({ type: 'end_subscribe', success });
    }, [subscribe]);

    const handleDismiss = useCallback(() => {
        sessionStorage.setItem(DISMISSED_KEY, 'true');
        dispatch({ type: 'hide' });
    }, []);

    if (!state.visible) return null;

    return (
        <div
            className={cn(
                'flex items-center justify-between gap-3 px-4 py-2',
                'bg-primary/10 border-b border-primary/20 text-foreground',
                'text-sm'
            )}
        >
            <div className="flex items-center gap-2 min-w-0">
                <Bell size={16} weight="duotone" className="shrink-0 text-primary" />
                <span className="truncate">
                    Enable desktop notifications to stay updated on activity in your workspace.
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <button
                    onClick={handleEnable}
                    disabled={state.subscribing}
                    className={cn(
                        'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'disabled:opacity-50'
                    )}
                >
                    {state.subscribing ? 'Enabling...' : 'Enable'}
                </button>
                <button
                    onClick={handleDismiss}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Dismiss notification banner"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
