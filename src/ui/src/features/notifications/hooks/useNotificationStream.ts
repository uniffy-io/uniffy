/**
 * Hook for streaming notifications in real-time via ConnectRPC server streaming.
 *
 * Subscribes to the StreamNotifications RPC and dispatches incoming
 * notifications to the Redux store. Includes reconnection with
 * exponential backoff. Passes an AbortSignal so the server-side
 * stream is cleanly cancelled on unmount or dependency change.
 */

import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchFile } from '@/features/files/store/filesSlice';
import { notificationsApi } from '@/features/notifications/api/notificationsApi';
import { addRealtimeNotification } from '@/features/notifications/store/notificationsSlice';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { StreamNotificationEvent_EventType } from '@/gen/notifications/v1/notifications_pb';

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Subscribe to real-time notification events.
 * Automatically reconnects with exponential backoff on disconnection.
 */
export function useNotificationStream() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!organizationId || !isAuthenticated) return;

        let backoff = INITIAL_BACKOFF_MS;
        let mounted = true;
        const pendingFileUpdates = new Map<string, ReturnType<typeof setTimeout>>();

        async function connect() {
            while (mounted) {
                // Abort any previous stream before starting a new one
                abortRef.current?.abort();
                abortRef.current = new AbortController();

                try {
                    const stream = notificationsApi.streamNotifications(
                        { organizationId: organizationId! },
                        { signal: abortRef.current.signal },
                    );

                    // Reset backoff on successful iteration start
                    backoff = INITIAL_BACKOFF_MS;

                    for await (const event of stream) {
                        if (!mounted) break;

                        if (event.eventType === StreamNotificationEvent_EventType.NEW_NOTIFICATION && event.notification) {
                            const n = event.notification;
                            const serialized: SerializedNotification = {
                                id: n.id,
                                organizationId: n.organizationId,
                                userId: n.userId,
                                notificationType: n.notificationType,
                                title: n.title,
                                body: n.body,
                                sourceUrn: n.sourceUrn,
                                actorId: n.actorId,
                                actorName: n.actorName,
                                actorAvatarUrl: n.actorAvatarUrl,
                                isRead: n.isRead,
                                readAt: n.readAt?.toDate().toISOString() ?? null,
                                createdAt: n.createdAt?.toDate().toISOString() ?? new Date().toISOString(),
                                expiresAt: n.expiresAt?.toDate().toISOString() ?? null,
                            };
                            dispatch(addRealtimeNotification(serialized));
                        }

                        // File processing completed -- debounce per file
                        if (event.eventType === StreamNotificationEvent_EventType.FILE_UPDATED && event.fileUpdate) {
                            const fileId = event.fileUpdate.fileId;
                            if (fileId) {
                                const existing = pendingFileUpdates.get(fileId);
                                if (existing) clearTimeout(existing);
                                pendingFileUpdates.set(fileId, setTimeout(() => {
                                    pendingFileUpdates.delete(fileId);
                                    dispatch(fetchFile(fileId));
                                }, 500));
                            }
                        }
                        // Heartbeats are silently consumed (keep-alive)
                    }
                } catch {
                    // Connection failed, dropped, or aborted
                    if (!mounted) break;

                    // Exponential backoff with jitter
                    const jitter = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, backoff + jitter));
                    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
                }
            }
        }

        connect();

        return () => {
            mounted = false;
            abortRef.current?.abort();
            abortRef.current = null;
            for (const timer of pendingFileUpdates.values()) {
                clearTimeout(timer);
            }
            pendingFileUpdates.clear();
        };
    }, [dispatch, organizationId, isAuthenticated]);
}
