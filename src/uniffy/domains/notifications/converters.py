"""Proto <-> domain converters for notifications domain."""

from uniffy_proto.notifications.v1.notifications_pb import (
    Notification as ProtoNotification,
)
from uniffy_proto.notifications.v1.notifications_pb import (
    NotificationType as ProtoNotificationType,
)

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.shared import NotificationType

NOTIFICATION_TYPE_TO_PROTO: dict[NotificationType, int] = {
    NotificationType.CONTENT_SHARED: ProtoNotificationType.CONTENT_SHARED,
    NotificationType.CONTENT_MENTIONED: ProtoNotificationType.CONTENT_MENTIONED,
    NotificationType.CONTENT_EDITED: ProtoNotificationType.CONTENT_EDITED,
    NotificationType.CALENDAR_REMINDER: ProtoNotificationType.CALENDAR_REMINDER,
    NotificationType.CALENDAR_INVITE: ProtoNotificationType.CALENDAR_INVITE,
    NotificationType.CALENDAR_RESPONSE: ProtoNotificationType.CALENDAR_RESPONSE,
    NotificationType.CALENDAR_CANCELLED: (ProtoNotificationType.CALENDAR_CANCELLED),
    NotificationType.PERMISSION_GRANTED: ProtoNotificationType.PERMISSION_GRANTED,
    NotificationType.PERMISSION_REVOKED: ProtoNotificationType.PERMISSION_REVOKED,
    NotificationType.SYSTEM_ANNOUNCEMENT: (ProtoNotificationType.SYSTEM_ANNOUNCEMENT),
    NotificationType.TASK_ASSIGNED: ProtoNotificationType.TASK_ASSIGNED,
    NotificationType.TASK_DUE_SOON: ProtoNotificationType.TASK_DUE_SOON,
    NotificationType.TASK_OVERDUE: ProtoNotificationType.TASK_OVERDUE,
    NotificationType.CHAT_MENTION: ProtoNotificationType.CHAT_MENTION,
    NotificationType.CHAT_DM: ProtoNotificationType.CHAT_DM,
    NotificationType.CHAT_CHANNEL_INVITE: (ProtoNotificationType.CHAT_CHANNEL_INVITE),
    NotificationType.CHAT_CHANNEL_REMOVED: (ProtoNotificationType.CHAT_CHANNEL_REMOVED),
    NotificationType.CHAT_THREAD_REPLY: (ProtoNotificationType.CHAT_THREAD_REPLY),
    NotificationType.ACCESS_REQUESTED: ProtoNotificationType.ACCESS_REQUESTED,
    NotificationType.ACCESS_REQUEST_DENIED: (ProtoNotificationType.ACCESS_REQUEST_DENIED),
    NotificationType.COMMENT_ADDED: ProtoNotificationType.COMMENT_ADDED,
    NotificationType.COMMENT_REPLY: ProtoNotificationType.COMMENT_REPLY,
    NotificationType.COMMENT_MENTIONED: ProtoNotificationType.COMMENT_MENTIONED,
    NotificationType.COMMENT_RESOLVED: ProtoNotificationType.COMMENT_RESOLVED,
    NotificationType.AGENTS_BUDGET_ALERT: (ProtoNotificationType.AGENTS_BUDGET_ALERT),
    NotificationType.SUPPORT_SESSION_REQUESTED: (ProtoNotificationType.SUPPORT_SESSION_REQUESTED),
    NotificationType.SUPPORT_SESSION_STARTED: (ProtoNotificationType.SUPPORT_SESSION_STARTED),
    NotificationType.SUPPORT_SESSION_REVOKED: (ProtoNotificationType.SUPPORT_SESSION_REVOKED),
    NotificationType.SUPPORT_SESSION_EXPIRED: (ProtoNotificationType.SUPPORT_SESSION_EXPIRED),
}

NOTIFICATION_TYPE_FROM_PROTO: dict[int, NotificationType] = {
    v: k for k, v in NOTIFICATION_TYPE_TO_PROTO.items()
}


def notification_type_to_proto(nt: NotificationType) -> int:
    return NOTIFICATION_TYPE_TO_PROTO.get(nt, ProtoNotificationType.UNSPECIFIED)


def notification_type_from_proto(proto_val: int) -> NotificationType | None:
    return NOTIFICATION_TYPE_FROM_PROTO.get(proto_val)


def notification_to_proto(
    notification: Notification,
    actor_name: str = "",
    actor_avatar_url: str = "",
) -> ProtoNotification:
    proto = ProtoNotification(
        id=str(notification.id),
        organization_id=str(notification.organization_id),
        user_id=str(notification.user_id),
        notification_type=notification_type_to_proto(notification.notification_type),
        title=notification.title,
        body=notification.body or "",
        is_read=notification.is_read,
        created_at=datetime_to_timestamp(notification.created_at),
        actor_name=actor_name,
        actor_avatar_url=actor_avatar_url,
    )

    if notification.source_urn:
        proto.source_urn = notification.source_urn

    if notification.actor_id:
        proto.actor_id = str(notification.actor_id)

    if notification.notification_metadata:
        proto.metadata.update({
            k: str(v) for k, v in notification.notification_metadata.items() if v is not None
        })

    read_at = optional_timestamp(notification.read_at)
    if read_at:
        proto.read_at = read_at

    expires_at = optional_timestamp(notification.expires_at)
    if expires_at:
        proto.expires_at = expires_at

    return proto
