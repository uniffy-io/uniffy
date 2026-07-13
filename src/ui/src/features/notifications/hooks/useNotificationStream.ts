/** Server-streamed notification feed with exponential-backoff reconnection. Module-level AbortController guarantees at most one active connection across remounts. */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { createElement } from 'react';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchFile } from '@/features/files/store/filesSlice';
import { initializeNotesData } from '@/features/notes/store/notesThunks';
import { emitContentAccessChanged, type ContentAccessAction } from '@/features/notifications/contentAccessEmitter';
import { notificationsApi } from '@/features/notifications/api/notificationsApi';
import { addRealtimeNotification, markNotificationAsRead, markNotificationsReadBySource } from '@/features/notifications/store/notificationsSlice';
import { isDocumentVisible } from '@/shared/utils/documentVisibility';
import type { SerializedNotification } from '@/features/notifications/store/notificationsSlice';
import { updatePresenceWithCustomStatus } from '@/features/presence/store/presenceSlice';
import { setDomainAdminDomains } from '@/features/auth/store/authSlice';
import { adminApi } from '@/features/admin/api/adminApi';
import { emitMentionStateChange } from '@/components/mention';
import { StreamNotificationsResponse_EventType } from '@uniffy/proto/notifications/v1/notifications_pb';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { getState } from '@/app/storeRef';
import { NotificationToast } from '@/features/notifications/components/NotificationToast';

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;

let _activeController: AbortController | null = null;

export function useNotificationStream() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
    const userId = useAppSelector((s) => s.auth.user?.id);
    const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!organizationId || !isAuthenticated) return;

        _activeController?.abort();

        let backoff = INITIAL_BACKOFF_MS;
        let mounted = true;
        const pendingFileUpdates = new Map<string, ReturnType<typeof setTimeout>>();
        let pendingTreeRefresh: ReturnType<typeof setTimeout> | null = null;

        async function connect() {
            while (mounted) {
                abortRef.current?.abort();
                abortRef.current = new AbortController();
                _activeController = abortRef.current;

                try {
                    const stream = notificationsApi.streamNotifications(
                        { organizationId: organizationId! },
                        { signal: abortRef.current.signal },
                    );

                    backoff = INITIAL_BACKOFF_MS;

                    for await (const event of stream) {
                        if (!mounted) break;

                        if (event.eventType === StreamNotificationsResponse_EventType.NEW_NOTIFICATION && event.notification) {
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
                                readAt: n.readAt ? timestampDate(n.readAt).toISOString() : null,
                                createdAt: n.createdAt ? timestampDate(n.createdAt).toISOString() : new Date().toISOString(),
                                expiresAt: n.expiresAt ? timestampDate(n.expiresAt).toISOString() : null,
                            };
                            dispatch(addRealtimeNotification(serialized));

                            const currentState = getState();

                            // A chat notification for the channel the user is
                            // actively viewing (open + window focused) is already
                            // being read: keep it out of the bell and suppress the
                            // toast. ChatStreamProvider advances the server cursor.
                            const CHAT_URN_PREFIX = 'urn:uniffy:content:CHAT:';
                            const chatChannelId = serialized.sourceUrn.startsWith(CHAT_URN_PREFIX)
                                ? serialized.sourceUrn.slice(CHAT_URN_PREFIX.length)
                                : null;
                            const activelyViewingChat =
                                chatChannelId !== null &&
                                chatChannelId === currentState?.chatChannels.activeChannelId &&
                                isDocumentVisible();

                            if (activelyViewingChat) {
                                dispatch(markNotificationsReadBySource(serialized.sourceUrn));
                            }

                            if (currentState && !activelyViewingChat) {
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

                        // FILE_UPDATED: debounce per file so a burst of part-ack events collapses to one refetch.
                        if (event.eventType === StreamNotificationsResponse_EventType.FILE_UPDATED && event.fileUpdate) {
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
                        if (
                            event.eventType ===
                                StreamNotificationsResponse_EventType.PRESENCE_CHANGED &&
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
                                              expiresAt: pc.statusExpiresAt
                                                  ? timestampDate(pc.statusExpiresAt).toISOString()
                                                  : null,
                                          }
                                        : undefined,
                                }),
                            );
                        }

                        // MENTION_STATE_CHANGED fans out to tag/live-mention projectors.
                        if (
                            event.eventType ===
                                StreamNotificationsResponse_EventType.MENTION_STATE_CHANGED &&
                            event.mentionStateChanged
                        ) {
                            const mc = event.mentionStateChanged;
                            if (mc.urn && mc.changes) {
                                emitMentionStateChange(mc.urn, mc.changes);
                            }
                        }

                        // CONTENT_ACCESS_CHANGED: the user's accessible-content set
                        // shifted (shared with them, or content became/ceased
                        // OPEN_TO_ORG). Notes keeps a global store, so refresh it
                        // regardless of route (off-page shares land too). Other
                        // domains fetch per-page and subscribe via
                        // useContentAccessRefetch - relay through the emitter.
                        if (
                            event.eventType ===
                                StreamNotificationsResponse_EventType.CONTENT_ACCESS_CHANGED &&
                            event.contentAccessChanged
                        ) {
                            const { contentType, contentId, action } = event.contentAccessChanged;
                            if (contentType === ContentType.NOTE && getState()?.notesTree.treeLoaded) {
                                if (pendingTreeRefresh) clearTimeout(pendingTreeRefresh);
                                pendingTreeRefresh = setTimeout(() => {
                                    pendingTreeRefresh = null;
                                    dispatch(initializeNotesData({ forceRefresh: true }));
                                }, 500);
                            }
                            emitContentAccessChanged({
                                contentType,
                                contentId,
                                action: action as ContentAccessAction,
                            });
                        }

                        if (
                            event.eventType ===
                                StreamNotificationsResponse_EventType.PERMISSIONS_CHANGED &&
                            userId
                        ) {
                            try {
                                const response = await adminApi.getUserDomainAdmins({
                                    organizationId: organizationId!,
                                    userId,
                                });
                                dispatch(setDomainAdminDomains(Array.from(response.domains)));
                            } catch {
                                // Non-fatal; updates on next login.
                            }
                        }
                    }
                } catch {
                    if (!mounted) break;

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
            if (pendingTreeRefresh) clearTimeout(pendingTreeRefresh);
        };
    }, [dispatch, organizationId, userId, isAuthenticated]);
}
