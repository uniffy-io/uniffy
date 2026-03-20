import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { presenceApi } from '@/features/presence/api/presenceApi';
import { fetchBulkPresence } from '@/features/presence/store/presenceThunks';
import { PresenceStatus } from '@uniffy/proto/presence/v1/presence_pb';

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds
const IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const ACTIVITY_THROTTLE_MS = 30_000; // Throttle activity detection

/**
 * App-wide presence heartbeat hook.
 *
 * Sends periodic heartbeats and tracks user activity for
 * automatic online/away transitions. Should be called once
 * in a top-level component (e.g. AppHeader).
 */
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
                // Non-fatal - presence is best-effort
            }
        },
        [organizationId],
    );

    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
        }

        // If currently away, send online when activity resumes
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

        // Send initial online presence
        sendPresence(PresenceStatus.ONLINE);

        // Fetch own presence (including custom status from DB) to
        // populate the store after page refresh / initial load.
        if (userId) {
            dispatch(
                fetchBulkPresence({
                    organizationId,
                    userIds: [userId],
                }),
            );
        }

        // Start heartbeat interval
        heartbeatRef.current = setInterval(() => {
            const status = isAwayRef.current
                ? PresenceStatus.AWAY
                : PresenceStatus.ONLINE;
            sendPresence(status);
        }, HEARTBEAT_INTERVAL_MS);

        // Start idle timer
        resetIdleTimer();

        // Throttled activity handler
        const handleActivity = () => {
            const now = Date.now();
            if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
            lastActivityRef.current = now;
            resetIdleTimer();
        };

        // Track user activity
        const events = ['mousemove', 'keydown', 'scroll', 'touchstart'] as const;
        for (const event of events) {
            window.addEventListener(event, handleActivity, { passive: true });
        }

        // Handle visibility change (tab hide/show)
        const handleVisibility = () => {
            if (document.hidden) {
                // Tab hidden - will naturally go away via idle timeout
            } else {
                // Tab visible again
                handleActivity();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // Handle tab close - best effort offline signal
        const handleUnload = () => {
            if (!organizationId) return;
            // Use sendBeacon for reliability on tab close
            const url = '/presence.v1.PresenceService/SetPresence';
            try {
                navigator.sendBeacon(url);
            } catch {
                // Best effort - TTL will handle cleanup
            }
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            // Cleanup
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
