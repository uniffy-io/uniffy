import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { notificationsApi } from '@/features/notifications/api/notificationsApi';
import { NotificationType } from '@uniffy/proto/notifications/v1/notifications_pb';
import type { Notification } from '@uniffy/proto/notifications/v1/notifications_pb';

export interface SerializedNotification {
    id: string;
    organizationId: string;
    userId: string;
    notificationType: number;
    title: string;
    body: string;
    sourceUrn: string;
    actorId: string;
    actorName: string;
    actorAvatarUrl: string;
    isRead: boolean;
    readAt: string | null;
    createdAt: string;
    expiresAt: string | null;
    metadata: Record<string, string>;
}

export type NotificationFilterType =
    | 'all'
    | 'unread'
    | 'content'
    | 'calendar'
    | 'permissions'
    | 'tasks'
    | 'chat'
    | 'system';

export interface NotificationsState {
    notifications: SerializedNotification[];
    unreadCount: number;
    loading: boolean;
    updating: boolean;
    error: string | null;
    totalCount: number;
    panelOpen: boolean;
    searchQuery: string;
    activeFilter: NotificationFilterType;
}

const initialState: NotificationsState = {
    notifications: [],
    unreadCount: 0,
    loading: false,
    updating: false,
    error: null,
    totalCount: 0,
    panelOpen: false,
    searchQuery: '',
    activeFilter: 'all',
};

const notificationToPlain = (n: Notification): SerializedNotification => ({
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
    metadata: { ...n.metadata },
});

export const fetchNotifications = createAsyncThunk<
    { notifications: SerializedNotification[]; totalCount: number; unreadCount: number },
    { page?: number; pageSize?: number } | void,
    { state: RootState; rejectValue: string }
>('notifications/fetchNotifications', async (params, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) {
        return rejectWithValue('No organization selected');
    }

    try {
        const response = await notificationsApi.listNotifications({
            organizationId,
            page: params?.page ?? 1,
            pageSize: params?.pageSize ?? 20,
        });

        return {
            notifications: response.notifications.map(notificationToPlain),
            totalCount: response.totalCount,
            unreadCount: response.unreadCount,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to fetch notifications'
        );
    }
});

export const fetchUnreadCount = createAsyncThunk<
    number,
    void,
    { state: RootState; rejectValue: string }
>('notifications/fetchUnreadCount', async (_, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) {
        return rejectWithValue('No organization selected');
    }

    try {
        const response = await notificationsApi.getUnreadCount({ organizationId });
        return response.unreadCount;
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to fetch unread count'
        );
    }
});

export const markNotificationAsRead = createAsyncThunk<
    SerializedNotification,
    string,
    { state: RootState; rejectValue: string }
>('notifications/markAsRead', async (notificationId, { rejectWithValue }) => {
    try {
        const response = await notificationsApi.markAsRead({ notificationId });
        if (!response.notification) {
            return rejectWithValue('Notification not found');
        }
        return notificationToPlain(response.notification);
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to mark as read'
        );
    }
});

export const markAllNotificationsAsRead = createAsyncThunk<
    number,
    void,
    { state: RootState; rejectValue: string }
>('notifications/markAllAsRead', async (_, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) {
        return rejectWithValue('No organization selected');
    }

    try {
        const response = await notificationsApi.markAllAsRead({ organizationId });
        return response.updatedCount;
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to mark all as read'
        );
    }
});

export const deleteNotification = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('notifications/deleteNotification', async (notificationId, { rejectWithValue }) => {
    try {
        await notificationsApi.deleteNotification({ notificationId });
        return notificationId;
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to delete notification'
        );
    }
});

const notificationsSlice = createSlice({
    name: 'notifications',
    initialState,
    reducers: {
        clearNotifications: () => initialState,

        togglePanel: (state) => {
            state.panelOpen = !state.panelOpen;
        },

        setPanel: (state, action: PayloadAction<boolean>) => {
            state.panelOpen = action.payload;
        },

        addRealtimeNotification: (state, action: PayloadAction<SerializedNotification>) => {
            state.notifications.unshift(action.payload);
            state.totalCount += 1;
            if (!action.payload.isRead) {
                state.unreadCount += 1;
            }
        },

        setUnreadCount: (state, action: PayloadAction<number>) => {
            state.unreadCount = action.payload;
        },

        clearError: (state) => {
            state.error = null;
        },

        setSearchQuery: (state, action: PayloadAction<string>) => {
            state.searchQuery = action.payload;
        },

        setActiveFilter: (state, action: PayloadAction<NotificationFilterType>) => {
            state.activeFilter = action.payload;
        },

        /** Mirrors the server-side cascade when originating content is marked read (e.g. opening a chat clears its mention/DM/thread-reply notifications). */
        markNotificationsReadBySource: (state, action: PayloadAction<string>) => {
            const sourceUrn = action.payload;
            if (!sourceUrn) return;
            const now = new Date().toISOString();
            let cleared = 0;
            for (const n of state.notifications) {
                if (n.sourceUrn === sourceUrn && !n.isRead) {
                    n.isRead = true;
                    n.readAt = now;
                    cleared += 1;
                }
            }
            if (cleared > 0) {
                state.unreadCount = Math.max(0, state.unreadCount - cleared);
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchNotifications.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchNotifications.fulfilled, (state, action) => {
                state.loading = false;
                state.notifications = action.payload.notifications;
                state.totalCount = action.payload.totalCount;
                state.unreadCount = action.payload.unreadCount;
            })
            .addCase(fetchNotifications.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch notifications';
            });

        builder
            .addCase(fetchUnreadCount.fulfilled, (state, action) => {
                state.unreadCount = action.payload;
            });

        builder
            .addCase(markNotificationAsRead.pending, (state) => {
                state.updating = true;
            })
            .addCase(markNotificationAsRead.fulfilled, (state, action) => {
                state.updating = false;
                const idx = state.notifications.findIndex(n => n.id === action.payload.id);
                if (idx !== -1) {
                    const wasUnread = !state.notifications[idx].isRead;
                    state.notifications[idx] = action.payload;
                    if (wasUnread) {
                        state.unreadCount = Math.max(0, state.unreadCount - 1);
                    }
                }
            })
            .addCase(markNotificationAsRead.rejected, (state, action) => {
                state.updating = false;
                state.error = action.payload ?? 'Failed to mark as read';
            });

        builder
            .addCase(markAllNotificationsAsRead.pending, (state) => {
                state.updating = true;
            })
            .addCase(markAllNotificationsAsRead.fulfilled, (state) => {
                state.updating = false;
                state.unreadCount = 0;
                for (const n of state.notifications) {
                    n.isRead = true;
                    n.readAt = new Date().toISOString();
                }
            })
            .addCase(markAllNotificationsAsRead.rejected, (state, action) => {
                state.updating = false;
                state.error = action.payload ?? 'Failed to mark all as read';
            });

        builder
            .addCase(deleteNotification.pending, (state) => {
                state.updating = true;
            })
            .addCase(deleteNotification.fulfilled, (state, action) => {
                state.updating = false;
                const idx = state.notifications.findIndex(n => n.id === action.payload);
                if (idx !== -1) {
                    if (!state.notifications[idx].isRead) {
                        state.unreadCount = Math.max(0, state.unreadCount - 1);
                    }
                    state.notifications.splice(idx, 1);
                    state.totalCount = Math.max(0, state.totalCount - 1);
                }
            })
            .addCase(deleteNotification.rejected, (state, action) => {
                state.updating = false;
                state.error = action.payload ?? 'Failed to delete notification';
            });

        builder
            .addMatcher(
                (action): action is { type: string; meta: { arg: string[] } } =>
                    action.type === 'notificationsPage/bulkMarkAsRead/fulfilled',
                (state, action) => {
                    const ids = new Set(action.meta.arg);
                    let unreadMarked = 0;
                    for (const n of state.notifications) {
                        if (ids.has(n.id) && !n.isRead) {
                            n.isRead = true;
                            n.readAt = new Date().toISOString();
                            unreadMarked++;
                        }
                    }
                    state.unreadCount = Math.max(0, state.unreadCount - unreadMarked);
                },
            )
            .addMatcher(
                (action): action is { type: string; meta: { arg: string[] } } =>
                    action.type === 'notificationsPage/bulkDelete/fulfilled',
                (state, action) => {
                    const ids = new Set(action.meta.arg);
                    let unreadDeleted = 0;
                    state.notifications = state.notifications.filter((n) => {
                        if (ids.has(n.id)) {
                            if (!n.isRead) unreadDeleted++;
                            return false;
                        }
                        return true;
                    });
                    state.totalCount = Math.max(0, state.totalCount - ids.size);
                    state.unreadCount = Math.max(0, state.unreadCount - unreadDeleted);
                },
            );
    },
});

const FILTER_TYPE_MAP: Record<string, number[]> = {
    content: [
        NotificationType.CONTENT_SHARED,
        NotificationType.CONTENT_MENTIONED,
        NotificationType.CONTENT_EDITED,
    ],
    calendar: [
        NotificationType.CALENDAR_REMINDER,
        NotificationType.CALENDAR_INVITE,
        NotificationType.CALENDAR_RESPONSE,
    ],
    permissions: [
        NotificationType.PERMISSION_GRANTED,
        NotificationType.PERMISSION_REVOKED,
    ],
    tasks: [
        NotificationType.TASK_ASSIGNED,
        NotificationType.TASK_DUE_SOON,
        NotificationType.TASK_OVERDUE,
    ],
    chat: [
        NotificationType.CHAT_MENTION,
        NotificationType.CHAT_DM,
        NotificationType.CHAT_CHANNEL_INVITE,
        NotificationType.CHAT_CHANNEL_REMOVED,
        NotificationType.CHAT_THREAD_REPLY,
    ],
    system: [
        NotificationType.SYSTEM_ANNOUNCEMENT,
    ],
};

export function selectFilteredNotifications(state: RootState): SerializedNotification[] {
    const { notifications, searchQuery, activeFilter } = state.notifications;

    let filtered = notifications;

    if (activeFilter === 'unread') {
        filtered = filtered.filter((n) => !n.isRead);
    } else if (activeFilter !== 'all') {
        const allowedTypes = FILTER_TYPE_MAP[activeFilter];
        if (allowedTypes) {
            filtered = filtered.filter((n) => allowedTypes.includes(n.notificationType));
        }
    }

    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        filtered = filtered.filter((n) =>
            n.title.toLowerCase().includes(query) ||
            n.body.toLowerCase().includes(query) ||
            n.actorName.toLowerCase().includes(query)
        );
    }

    return filtered;
}

export const {
    clearNotifications,
    togglePanel,
    setPanel,
    addRealtimeNotification,
    setUnreadCount,
    clearError,
    setSearchQuery,
    setActiveFilter,
    markNotificationsReadBySource,
} = notificationsSlice.actions;
export const notificationsReducer = notificationsSlice.reducer;
