from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from uniffy_proto.permissions.v1.permissions_pb2 import ACCESS_REQUEST_STATE_DENIED
from uniffy_proto.notifications.v1.notifications_pb2 import NotificationType as ProtoNotificationType

from uniffy.core.valkey import pubsub
from uniffy.core.valkey.pubsub import NotificationPayloadType
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.converters import (
    notification_type_from_proto,
    notification_type_to_proto,
)


def test_access_request_notification_types_round_trip() -> None:
    for notification_type, proto_type in (
        (
            NotificationType.ACCESS_REQUESTED,
            ProtoNotificationType.NOTIFICATION_TYPE_ACCESS_REQUESTED,
        ),
        (
            NotificationType.ACCESS_REQUEST_DENIED,
            ProtoNotificationType.NOTIFICATION_TYPE_ACCESS_REQUEST_DENIED,
        ),
    ):
        assert notification_type_to_proto(notification_type) == proto_type
        assert notification_type_from_proto(proto_type) == notification_type


async def test_access_request_stream_publisher_targets_requester() -> None:
    requester_id = generate_id()
    request_id = generate_id()
    retry_at = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)
    publish = AsyncMock()

    with patch.object(pubsub, "publish_to_channel", publish):
        await pubsub.publish_access_request_changed(
            user_id=requester_id,
            request_id=request_id,
            requested_urn="urn:uniffy:content:NOTE:019fc01f-12b6-7c82-bb38-2849821c22cb",
            state=ACCESS_REQUEST_STATE_DENIED,
            can_request_again_at=retry_at,
        )

    publish.assert_awaited_once_with(
        f"notifications:{requester_id}",
        {
            "_type": NotificationPayloadType.ACCESS_REQUEST_CHANGED,
            "request_id": str(request_id),
            "requested_urn": "urn:uniffy:content:NOTE:019fc01f-12b6-7c82-bb38-2849821c22cb",
            "state": ACCESS_REQUEST_STATE_DENIED,
            "can_request_again_at": retry_at.isoformat(),
        },
    )
