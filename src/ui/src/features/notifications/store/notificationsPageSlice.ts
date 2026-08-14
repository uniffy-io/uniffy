import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { notificationsApi } from "@/features/notifications/api/notificationsApi";
import {
  markNotificationAsRead,
  deleteNotification,
} from "@/features/notifications/store/notificationsSlice";
import type { Notification } from "@uniffy/proto/notifications/v1/notifications_pb";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";

export interface SerializedDailyStat {
  date: string;
  total: number;
  unread: number;
  read: number;
}

export interface SerializedTypeStat {
  notificationType: number;
  count: number;
}

export interface NotificationStats {
  dailyStats: SerializedDailyStat[];
  typeStats: SerializedTypeStat[];
  totalCount: number;
  unreadCount: number;
  readCount: number;
}

export interface SerializedPageNotification {
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

export type PageViewMode = "list" | "grouped";

export interface NotificationsPageState {
  notifications: SerializedPageNotification[];
  searchQuery: string;
  selectedTypes: number[];
  isReadFilter: boolean | null;
  dateFrom: string | null;
  dateTo: string | null;
  actorId: string | null;
  viewMode: PageViewMode;
  analyticsTimeRange: number;
  stats: NotificationStats | null;
  analyticsCollapsed: boolean;
  selectedIds: string[];
  page: number;
  pageSize: number;
  totalCount: number;
  unreadCount: number;
  loading: boolean;
  statsLoading: boolean;
  updating: boolean;
  error: string | null;
  filterSidebarOpen: boolean;
  lastActionMessage: string | null;
}

const initialState: NotificationsPageState = {
  notifications: [],
  searchQuery: "",
  selectedTypes: [],
  isReadFilter: null,
  dateFrom: null,
  dateTo: null,
  actorId: null,
  viewMode: "list",
  analyticsTimeRange: 30,
  stats: null,
  analyticsCollapsed: true,
  selectedIds: [],
  page: 1,
  pageSize: 20,
  totalCount: 0,
  unreadCount: 0,
  loading: false,
  statsLoading: false,
  updating: false,
  error: null,
  filterSidebarOpen: true,
  lastActionMessage: null,
};

const notificationToPlain = (n: Notification): SerializedPageNotification => ({
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

export const searchPageNotifications = createAsyncThunk<
  { notifications: SerializedPageNotification[]; totalCount: number; unreadCount: number },
  void,
  { state: RootState; rejectValue: string }
>("notificationsPage/search", async (_, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  const pageState = getState().notificationsPage;

  try {
    const protoTypes = pageState.selectedTypes.length > 0 ? pageState.selectedTypes : undefined;

    const response = await notificationsApi.searchNotifications({
      organizationId,
      query: pageState.searchQuery,
      page: pageState.page,
      pageSize: pageState.pageSize,
      isRead: pageState.isReadFilter ?? undefined,
      notificationTypes: protoTypes,
      dateFrom: pageState.dateFrom ? timestampFromDate(new Date(pageState.dateFrom)) : undefined,
      dateTo: pageState.dateTo ? timestampFromDate(new Date(pageState.dateTo)) : undefined,
      actorId: pageState.actorId ?? undefined,
    });

    return {
      notifications: response.notifications.map(notificationToPlain),
      totalCount: response.totalCount,
      unreadCount: response.unreadCount,
    };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to search notifications",
    );
  }
});

export const fetchPageNotificationStats = createAsyncThunk<
  NotificationStats,
  void,
  { state: RootState; rejectValue: string }
>("notificationsPage/fetchStats", async (_, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  const days = getState().notificationsPage.analyticsTimeRange;

  try {
    const response = await notificationsApi.getNotificationStats({
      organizationId,
      days,
    });

    return {
      dailyStats: response.dailyStats.map((s) => ({
        date: s.date,
        total: s.total,
        unread: s.unread,
        read: s.read,
      })),
      typeStats: response.typeStats.map((s) => ({
        notificationType: s.notificationType,
        count: s.count,
      })),
      totalCount: response.totalCount,
      unreadCount: response.unreadCount,
      readCount: response.readCount,
    };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch notification stats",
    );
  }
});

export const bulkMarkAsReadPage = createAsyncThunk<
  number,
  string[],
  { state: RootState; rejectValue: string }
>("notificationsPage/bulkMarkAsRead", async (notificationIds, { rejectWithValue }) => {
  try {
    const response = await notificationsApi.bulkMarkAsRead({
      notificationIds,
    });
    return response.updatedCount;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to mark notifications as read",
    );
  }
});

export const bulkDeleteNotificationsPage = createAsyncThunk<
  number,
  string[],
  { state: RootState; rejectValue: string }
>("notificationsPage/bulkDelete", async (notificationIds, { rejectWithValue }) => {
  try {
    const response = await notificationsApi.bulkDeleteNotifications({
      notificationIds,
    });
    return response.deletedCount;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to delete notifications",
    );
  }
});

const NOTIFICATION_TYPE_CATEGORIES: Record<string, number[]> = {
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
  permissions: [NotificationType.PERMISSION_GRANTED, NotificationType.PERMISSION_REVOKED],
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
  system: [NotificationType.SYSTEM_ANNOUNCEMENT],
};

export { NOTIFICATION_TYPE_CATEGORIES };

const notificationsPageSlice = createSlice({
  name: "notificationsPage",
  initialState,
  reducers: {
    setPageSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
      state.page = 1;
    },
    setSelectedTypes: (state, action: PayloadAction<number[]>) => {
      state.selectedTypes = action.payload;
      state.page = 1;
    },
    toggleSelectedType: (state, action: PayloadAction<number>) => {
      const idx = state.selectedTypes.indexOf(action.payload);
      if (idx >= 0) {
        state.selectedTypes.splice(idx, 1);
      } else {
        state.selectedTypes.push(action.payload);
      }
      state.page = 1;
    },
    setIsReadFilter: (state, action: PayloadAction<boolean | null>) => {
      state.isReadFilter = action.payload;
      state.page = 1;
    },
    setDateRange: (state, action: PayloadAction<{ from: string | null; to: string | null }>) => {
      state.dateFrom = action.payload.from;
      state.dateTo = action.payload.to;
      state.page = 1;
    },
    setActorFilter: (state, action: PayloadAction<string | null>) => {
      state.actorId = action.payload;
      state.page = 1;
    },
    setViewMode: (state, action: PayloadAction<PageViewMode>) => {
      state.viewMode = action.payload;
    },
    setAnalyticsTimeRange: (state, action: PayloadAction<number>) => {
      state.analyticsTimeRange = action.payload;
    },
    toggleAnalyticsCollapsed: (state) => {
      state.analyticsCollapsed = !state.analyticsCollapsed;
    },
    setPage: (state, action: PayloadAction<number>) => {
      state.page = action.payload;
    },
    toggleSelectedId: (state, action: PayloadAction<string>) => {
      const idx = state.selectedIds.indexOf(action.payload);
      if (idx >= 0) {
        state.selectedIds.splice(idx, 1);
      } else {
        state.selectedIds.push(action.payload);
      }
    },
    selectAllOnPage: (state) => {
      state.selectedIds = state.notifications.map((n) => n.id);
    },
    toggleSelectedGroup: (state, action: PayloadAction<string[]>) => {
      const groupIds = action.payload;
      const allSelected = groupIds.every((id) => state.selectedIds.includes(id));
      if (allSelected) {
        state.selectedIds = state.selectedIds.filter((id) => !groupIds.includes(id));
      } else {
        const toAdd = groupIds.filter((id) => !state.selectedIds.includes(id));
        state.selectedIds.push(...toAdd);
      }
    },
    clearSelection: (state) => {
      state.selectedIds = [];
    },
    clearAllFilters: (state) => {
      state.searchQuery = "";
      state.selectedTypes = [];
      state.isReadFilter = null;
      state.dateFrom = null;
      state.dateTo = null;
      state.actorId = null;
      state.page = 1;
    },
    setFilterSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.filterSidebarOpen = action.payload;
    },
    toggleFilterSidebar: (state) => {
      state.filterSidebarOpen = !state.filterSidebarOpen;
    },
    clearLastAction: (state) => {
      state.lastActionMessage = null;
    },
    resetNotificationsPage: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(searchPageNotifications.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(searchPageNotifications.fulfilled, (state, action) => {
        state.loading = false;
        state.notifications = action.payload.notifications;
        state.totalCount = action.payload.totalCount;
        state.unreadCount = action.payload.unreadCount;
      })
      .addCase(searchPageNotifications.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to search notifications";
      });

    builder
      .addCase(fetchPageNotificationStats.pending, (state) => {
        state.statsLoading = true;
      })
      .addCase(fetchPageNotificationStats.fulfilled, (state, action) => {
        state.statsLoading = false;
        state.stats = action.payload;
      })
      .addCase(fetchPageNotificationStats.rejected, (state) => {
        state.statsLoading = false;
      });

    builder
      .addCase(bulkMarkAsReadPage.pending, (state) => {
        state.updating = true;
      })
      .addCase(bulkMarkAsReadPage.fulfilled, (state) => {
        state.updating = false;
        const count = state.selectedIds.length;
        for (const n of state.notifications) {
          if (state.selectedIds.includes(n.id)) {
            n.isRead = true;
            n.readAt = new Date().toISOString();
          }
        }
        state.selectedIds = [];
        state.lastActionMessage = `Marked ${count} notification${count !== 1 ? "s" : ""} as read`;
      })
      .addCase(bulkMarkAsReadPage.rejected, (state) => {
        state.updating = false;
      });

    builder
      .addCase(bulkDeleteNotificationsPage.pending, (state) => {
        state.updating = true;
      })
      .addCase(bulkDeleteNotificationsPage.fulfilled, (state) => {
        state.updating = false;
        const count = state.selectedIds.length;
        state.notifications = state.notifications.filter((n) => !state.selectedIds.includes(n.id));
        state.totalCount = Math.max(0, state.totalCount - count);
        state.selectedIds = [];
        state.lastActionMessage = `Deleted ${count} notification${count !== 1 ? "s" : ""}`;
      })
      .addCase(bulkDeleteNotificationsPage.rejected, (state) => {
        state.updating = false;
      });

    builder
      .addCase(markNotificationAsRead.fulfilled, (state, action) => {
        const updated = action.payload;
        const idx = state.notifications.findIndex((n) => n.id === updated.id);
        if (idx !== -1) {
          state.notifications[idx].isRead = true;
          state.notifications[idx].readAt = updated.readAt;
        }
        if (state.unreadCount > 0) {
          state.unreadCount -= 1;
        }
        state.lastActionMessage = "Marked as read";
      })
      .addCase(deleteNotification.fulfilled, (state, action) => {
        const deletedId = action.meta.arg;
        state.notifications = state.notifications.filter((n) => n.id !== deletedId);
        state.totalCount = Math.max(0, state.totalCount - 1);
        state.lastActionMessage = "Notification deleted";
      });
  },
});

export const {
  setPageSearchQuery,
  setSelectedTypes,
  toggleSelectedType,
  setIsReadFilter,
  setDateRange,
  setActorFilter,
  setViewMode,
  setAnalyticsTimeRange,
  toggleAnalyticsCollapsed,
  setPage,
  toggleSelectedId,
  toggleSelectedGroup,
  selectAllOnPage,
  clearSelection,
  clearAllFilters,
  setFilterSidebarOpen,
  toggleFilterSidebar,
  clearLastAction,
  resetNotificationsPage,
} = notificationsPageSlice.actions;

export const notificationsPageReducer = notificationsPageSlice.reducer;
