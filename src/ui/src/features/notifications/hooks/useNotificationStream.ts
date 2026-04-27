/**
 * Hook for streaming notifications in real-time via ConnectRPC server streaming.
 *
 * Subscribes to the StreamNotifications RPC and dispatches incoming
 * notifications to the Redux store. Includes reconnection with
 * exponential backoff. Passes an AbortSignal so the server-side
 * stream is cleanly cancelled on unmount or dependency change.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { createElement } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchFile } from '@/features/files/store/filesSlice';
import { notificationsApi } from '@/features/notifications/api/notificationsApi';
import { addRealtimeNotification, markNotificationAsRead } from '@/features/notifications/store/notificationsSlice';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { updatePresenceWithCustomStatus } from '@/features/presence/store/presenceSlice';
import { setDomainAdminDomains } from '@/features/auth/store/authSlice';
import { adminApi } from '@/features/admin/api/adminApi';
import { emitMentionStateChange } from '@/components/mention';
import { StreamNotificationEvent_EventType } from '@uniffy/proto/notifications/v1/notifications_pb';
import { getState } from '@/app/storeRef';
import { NotificationToast } from '@/features/notifications/components/NotificationToast';

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;

// Module-level singleton: ensures only one notification stream exists process-wide.
// If a second mount happens before the first cleanup, the old connection is aborted.
let _activeController: AbortController | null = null;

/**
 * Subscribe to real-time notification events.
 * Automatically reconnects with exponential backoff on disconnection.
 *
 * Uses a module-level AbortController to guarantee at most one active
 * connection, even if multiple component instances mount concurrently
 * (e.g. during page transitions or React Strict Mode double-effects).
 */
export function useNotificationStream() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const userId = useAppSelector((s) => s.auth.user?.id);
    const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!organizationId || !isAuthenticated) return;

        // Abort any previously active stream from another mount
        _activeController?.abort();

        let backoff = INITIAL_BACKOFF_MS;
        let mounted = true;
        const pendingFileUpdates = new Map<string, ReturnType<typeof setTimeout>>();

        async function connect() {
            while (mounted) {
                // Abort any previous stream before starting a new one
                abortRef.current?.abort();
                abortRef.current = new AbortController();
                _activeController = abortRef.current;

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

                            // Toast notification logic
                            const currentState = getState();
                            if (currentState) {
                                const toastEnabled = currentState.settings.effectiveSettings?.notifications.toastEnabled ?? false;
                                const isZenMode = currentState.zenMode.isActive;
                                const isPanelOpen = currentState.notifications.panelOpen;

                                if (toastEnabled && !isZenMode && !isPanelOpen) {
                                    const toastId = `notification-${serialized.id}`;
                                    toast.custom(
                                        (id) => createElement(NotificationToast, {
                                            notification: serialized,
                                            toastId: id,
                                            onMarkAsRead: (notifId: string) => {
                                                dispatch(markNotificationAsRead(notifId));
                                            },
                                        }),
                                        {
                                            id: toastId,
                                            duration: 5000,
                                        }
                                    );
                                }
                            }
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
                        // Presence state changed
                        if (
                            event.eventType ===
                                StreamNotificationEvent_EventType.PRESENCE_CHANGED &&
                            event.presenceChanged
                        ) {
                            const pc = event.presenceChanged;
                            const hasCustomStatus = !!(pc.statusEmoji || pc.statusText);
                            dispatch(
                                updatePresenceWithCustomStatus({
                                    userId: pc.userId,
                                    status: pc.status,
                                    customStatus: hasCustomStatus
                                        ? {
                                              emoji: pc.statusEmoji,
                                              text: pc.statusText,
                                              expiresAt:
                                                  pc.statusExpiresAt
                                                      ?.toDate()
                                                      .toISOString() ?? null,
                                          }
                                        : undefined,
                                }),
                            );
                        }

                        // Mention state changed (live mentions)
                        if (
                            event.eventType ===
                                StreamNotificationEvent_EventType.MENTION_STATE_CHANGED &&
                            event.mentionStateChanged
                        ) {
                            const mc = event.mentionStateChanged;
                            if (mc.urn && mc.changes) {
                                emitMentionStateChange(mc.urn, mc.changes);
                            }
                        }

                        // Permissions changed - refetch domain admin domains
                        if (
                            event.eventType ===
                                StreamNotificationEvent_EventType.PERMISSIONS_CHANGED &&
                            userId
                        ) {
                            try {
                                const response = await adminApi.getUserDomainAdmins({
                                    organizationId: organizationId!,
                                    userId,
                                });
                                dispatch(setDomainAdminDomains(Array.from(response.domains)));
                            } catch {
                                // Non-fatal - permissions will update on next login
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
            if (_activeController === abortRef.current) {
                _activeController = null;
            }
            abortRef.current = null;
            for (const timer of pendingFileUpdates.values()) {
                clearTimeout(timer);
            }
            pendingFileUpdates.clear();
        };
    }, [dispatch, organizationId, userId, isAuthenticated]);
}
