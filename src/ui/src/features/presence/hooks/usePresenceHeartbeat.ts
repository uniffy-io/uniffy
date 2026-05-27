import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { presenceApi } from '@/features/presence/api/presenceApi';
import { fetchBulkPresence } from '@/features/presence/store/presenceThunks';
import { PresenceStatus } from '@uniffy/proto/presence/v1/presence_pb';

// Heartbeat tuned so the backend stale-presence GC marks offline within 2x without
// over-spamming SetPresence. Idle threshold matches typical "away" UX on chat apps.
const HEARTBEAT_INTERVAL_MS = 60_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;
const ACTIVITY_THROTTLE_MS = 30_000;

/** Call once at the top of the tree (e.g. AppHeader). */
export function usePresenceHeartbeat() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
    const userId = useAppSelector((s) => s.auth.user?.id);

    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAwayRef = useRef(false);
    const lastActivityRef = useRef(0);

    const sendPresence = useCallback(
        async (status: PresenceStatus) => {
            if (!organizationId) return;
            try {
                await presenceApi.setPresence({
                    organizationId,
                    status,
                    client: 'web',
                });
            } catch {
                // best-effort
            }
        },
        [organizationId],
    );

    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
        }

        if (isAwayRef.current) {
            isAwayRef.current = false;
            sendPresence(PresenceStatus.ONLINE);
        }

        idleTimerRef.current = setTimeout(() => {
            isAwayRef.current = true;
            sendPresence(PresenceStatus.AWAY);
        }, IDLE_TIMEOUT_MS);
    }, [sendPresence]);

    useEffect(() => {
        if (!isAuthenticated || !organizationId) return;

        sendPresence(PresenceStatus.ONLINE);

        // Rehydrate own custom status from DB after page refresh.
        if (userId) {
            dispatch(
                fetchBulkPresence({
                    organizationId,
                    userIds: [userId],
                }),
            );
        }

        heartbeatRef.current = setInterval(() => {
            const status = isAwayRef.current
                ? PresenceStatus.AWAY
                : PresenceStatus.ONLINE;
            sendPresence(status);
        }, HEARTBEAT_INTERVAL_MS);

        resetIdleTimer();

        const handleActivity = () => {
            const now = Date.now();
            if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
            lastActivityRef.current = now;
            resetIdleTimer();
        };

        const events = ['mousemove', 'keydown', 'scroll', 'touchstart'] as const;
        for (const event of events) {
            window.addEventListener(event, handleActivity, { passive: true });
        }

        const handleVisibility = () => {
            if (document.hidden) {
                // Hidden tabs drift to away via the idle timer.
            } else {
                handleActivity();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // sendBeacon is fire-and-forget on tab close; TTL on the server side handles cleanup either way.
        const handleUnload = () => {
            if (!organizationId) return;
            const url = '/presence.v1.PresenceService/SetPresence';
            try {
                navigator.sendBeacon(url);
            } catch {
                // best-effort
            }
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
            }
            for (const event of events) {
                window.removeEventListener(event, handleActivity);
            }
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('beforeunload', handleUnload);
        };
    }, [isAuthenticated, organizationId, userId, dispatch, sendPresence, resetIdleTimer]);
}
