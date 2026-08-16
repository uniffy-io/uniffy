import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { useAppDispatch } from "@/app/hooks";
import { openAccessRequestReviewDialog } from "@/features/permissions/store/accessRequestsSlice";
import {
  markNotificationAsRead,
  type SerializedNotification,
} from "@/features/notifications/store/notificationsSlice";
import { notificationTargetPath } from "@/features/notifications/utils/notificationTarget";

export function isReviewableAccessRequest(notification: SerializedNotification): boolean {
  return (
    notification.notificationType === NotificationType.ACCESS_REQUESTED &&
    !!notification.metadata.request_id
  );
}

export type NotificationAction =
  | { kind: "review_access_request"; requestId: string }
  | { kind: "navigate"; path: string }
  | { kind: "none" };

export function notificationActionFor(notification: SerializedNotification): NotificationAction {
  if (notification.notificationType === NotificationType.ACCESS_REQUESTED) {
    const requestId = notification.metadata.request_id;
    return requestId ? { kind: "review_access_request", requestId } : { kind: "none" };
  }

  const path = notificationTargetPath(notification);
  return path ? { kind: "navigate", path } : { kind: "none" };
}

export function useNotificationAction(
  onHandled?: () => void,
  markAsRead?: (notificationId: string) => void,
) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return useCallback(
    (notification: SerializedNotification) => {
      if (!notification.isRead) {
        if (markAsRead) markAsRead(notification.id);
        else dispatch(markNotificationAsRead(notification.id));
      }

      const action = notificationActionFor(notification);
      if (action.kind === "review_access_request") {
        dispatch(openAccessRequestReviewDialog(action.requestId));
      } else if (action.kind === "navigate") {
        navigate(action.path);
      }
      onHandled?.();
    },
    [dispatch, markAsRead, navigate, onHandled],
  );
}
