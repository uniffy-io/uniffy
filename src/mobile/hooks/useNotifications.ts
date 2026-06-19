import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { notificationsApi } from "@/api/notificationsApi";
import { notificationToPlain, type SerializedNotification } from "@/lib/notificationSerializer";

const UNREAD_POLL_MS = 15000;

export interface NotificationFeed {
  notifications: SerializedNotification[];
  totalCount: number;
  unreadCount: number;
}

export function useNotifications(unreadOnly: boolean) {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["notifications", "feed", organizationId, unreadOnly],
    enabled: !!organizationId && isAuthenticated,
    queryFn: async (): Promise<NotificationFeed> => {
      const res = await notificationsApi.listNotifications({
        organizationId: organizationId!,
        page: 1,
        pageSize: 50,
        ...(unreadOnly ? { isRead: false } : {}),
      });
      return {
        notifications: res.notifications.map(notificationToPlain),
        totalCount: res.totalCount,
        unreadCount: res.unreadCount,
      };
    },
  });
}

/** Polls the unread badge count for the TopNav bell. */
export function useUnreadNotificationCount() {
  const { organizationId, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["notifications", "unread-count", organizationId],
    enabled: !!organizationId && isAuthenticated,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => {
      const res = await notificationsApi.getUnreadCount({ organizationId: organizationId! });
      return res.unreadCount;
    },
  });
}

function useInvalidateNotifications() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["notifications", "feed", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count", organizationId] });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead({ notificationId }),
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const { organizationId } = useAuth();
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: () => notificationsApi.markAllAsRead({ organizationId: organizationId! }),
    onSuccess: invalidate,
  });
}

export function useDeleteNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.deleteNotification({ notificationId }),
    onSuccess: invalidate,
  });
}
