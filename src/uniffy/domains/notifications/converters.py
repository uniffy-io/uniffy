"""Proto <-> domain converters for notifications domain."""

from uniffy_proto.notifications.v1.notifications_pb2 import (
    Notification as ProtoNotification,
)
from uniffy_proto.notifications.v1.notifications_pb2 import (
    NotificationType as ProtoNotificationType,
)

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.shared import NotificationType

# Mapping from domain NotificationType to proto NotificationType
NOTIFICATION_TYPE_TO_PROTO: dict[NotificationType, int] = {
    NotificationType.CONTENT_SHARED: ProtoNotificationType.NOTIFICATION_TYPE_CONTENT_SHARED,
    NotificationType.CONTENT_MENTIONED: ProtoNotificationType.NOTIFICATION_TYPE_CONTENT_MENTIONED,
    NotificationType.CONTENT_EDITED: ProtoNotificationType.NOTIFICATION_TYPE_CONTENT_EDITED,
    NotificationType.CALENDAR_REMINDER: ProtoNotificationType.NOTIFICATION_TYPE_CALENDAR_REMINDER,
    NotificationType.CALENDAR_INVITE: ProtoNotificationType.NOTIFICATION_TYPE_CALENDAR_INVITE,
    NotificationType.CALENDAR_RESPONSE: ProtoNotificationType.NOTIFICATION_TYPE_CALENDAR_RESPONSE,
    NotificationType.PERMISSION_GRANTED: ProtoNotificationType.NOTIFICATION_TYPE_PERMISSION_GRANTED,
    NotificationType.PERMISSION_REVOKED: ProtoNotificationType.NOTIFICATION_TYPE_PERMISSION_REVOKED,
    NotificationType.SYSTEM_ANNOUNCEMENT: (
        ProtoNotificationType.NOTIFICATION_TYPE_SYSTEM_ANNOUNCEMENT
    ),
    NotificationType.TASK_ASSIGNED: ProtoNotificationType.NOTIFICATION_TYPE_TASK_ASSIGNED,
    NotificationType.TASK_DUE_SOON: ProtoNotificationType.NOTIFICATION_TYPE_TASK_DUE_SOON,
    NotificationType.TASK_OVERDUE: ProtoNotificationType.NOTIFICATION_TYPE_TASK_OVERDUE,
    NotificationType.CHAT_MENTION: ProtoNotificationType.NOTIFICATION_TYPE_CHAT_MENTION,
    NotificationType.CHAT_DM: ProtoNotificationType.NOTIFICATION_TYPE_CHAT_DM,
    NotificationType.CHAT_CHANNEL_INVITE: (
        ProtoNotificationType.NOTIFICATION_TYPE_CHAT_CHANNEL_INVITE
    ),
    NotificationType.CHAT_CHANNEL_REMOVED: (
        ProtoNotificationType.NOTIFICATION_TYPE_CHAT_CHANNEL_REMOVED
    ),
    NotificationType.CHAT_THREAD_REPLY: (ProtoNotificationType.NOTIFICATION_TYPE_CHAT_THREAD_REPLY),
}

# Reverse mapping
NOTIFICATION_TYPE_FROM_PROTO: dict[int, NotificationType] = {
    v: k for k, v in NOTIFICATION_TYPE_TO_PROTO.items()
}


def notification_type_to_proto(nt: NotificationType) -> int:
    """
    Convert domain NotificationType to proto enum value.

    Parameters
    ----------
    nt : NotificationType
        Domain notification type.

    Returns
    -------
    int
        Proto enum value.

    """
    return NOTIFICATION_TYPE_TO_PROTO.get(nt, ProtoNotificationType.NOTIFICATION_TYPE_UNSPECIFIED)


def notification_type_from_proto(proto_val: int) -> NotificationType | None:
    """
    Convert proto enum value to domain NotificationType.

    Parameters
    ----------
    proto_val : int
        Proto notification type enum value.

    Returns
    -------
    NotificationType | None
        Domain notification type, or None if unspecified.

    """
    return NOTIFICATION_TYPE_FROM_PROTO.get(proto_val)


def notification_to_proto(
    notification: Notification,
    actor_name: str = "",
    actor_avatar_url: str = "",
) -> ProtoNotification:
    """
    Convert Notification model to proto Notification.

    Parameters
    ----------
    notification : Notification
        Notification model instance.
    actor_name : str
        Display name of the actor who triggered the notification.
    actor_avatar_url : str
        Avatar URL of the actor.

    Returns
    -------
    ProtoNotification
        Proto message.

    """
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

    read_at = optional_timestamp(notification.read_at)
    if read_at:
        proto.read_at.CopyFrom(read_at)

    expires_at = optional_timestamp(notification.expires_at)
    if expires_at:
        proto.expires_at.CopyFrom(expires_at)

    return proto
