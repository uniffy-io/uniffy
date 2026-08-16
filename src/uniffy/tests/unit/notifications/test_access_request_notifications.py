from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy_proto.permissions.v1.permissions_pb2 import ACCESS_REQUEST_STATE_DENIED

from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.permissions.access_request_notifications import AccessRequestNotifier
from uniffy.domains.permissions.access_request_targets import (
    AccessGrantKind,
    AccessRequestTarget,
)


def _request() -> ContentAccessRequest:
    content_id = generate_id()
    return ContentAccessRequest(
        organization_id=generate_id(),
        requester_id=generate_id(),
        requested_urn=f"urn:uniffy:content:NOTE:{content_id}",
        original_content_type=ContentType.NOTE,
        original_content_id=content_id,
        canonical_content_type=ContentType.NOTE,
        canonical_content_id=content_id,
        state=ContentAccessRequestState.PENDING,
        message="Please share the planning note.",
    )


def _target(request: ContentAccessRequest, owner_id) -> AccessRequestTarget:
    return AccessRequestTarget(
        requested_urn=request.requested_urn,
        original_content_type=request.original_content_type,
        original_content_id=request.original_content_id,
        canonical_content_type=request.canonical_content_type,
        canonical_content_id=request.canonical_content_id,
        grant_kind=AccessGrantKind.STANDARD,
        canonical_row=SimpleNamespace(owner_id=owner_id),
    )


async def test_requested_notification_targets_owner_and_keeps_source_urn() -> None:
    request = _request()
    owner_id = generate_id()
    emit = AsyncMock()

    with patch(
        "uniffy.domains.permissions.access_request_notifications.emit_notification",
        emit,
    ):
        await AccessRequestNotifier(MagicMock()).notify_requested(
            request,
            _target(request, owner_id),
        )

    event = emit.await_args.args[0]
    assert event.notification_type == NotificationType.ACCESS_REQUESTED
    assert event.target_user_ids == [owner_id]
    assert event.source_urn == request.requested_urn
    assert event.metadata["request_id"] == str(request.id)


async def test_denial_notification_omits_source_urn() -> None:
    request = _request()
    request.state = ContentAccessRequestState.DENIED
    request.decision_note = "The note is not ready to share."
    reviewer_id = generate_id()
    emit = AsyncMock()

    with patch(
        "uniffy.domains.permissions.access_request_notifications.emit_notification",
        emit,
    ):
        await AccessRequestNotifier(MagicMock()).notify_denied(request, reviewer_id)

    event = emit.await_args.args[0]
    assert event.notification_type == NotificationType.ACCESS_REQUEST_DENIED
    assert event.target_user_ids == [request.requester_id]
    assert event.source_urn is None
    assert event.metadata["requested_urn"] == request.requested_urn


async def test_denied_state_stream_includes_cooldown() -> None:
    request = _request()
    responded_at = datetime(2026, 8, 16, 12, 0, tzinfo=UTC)
    request.state = ContentAccessRequestState.DENIED
    request.responded_at = responded_at
    publish = AsyncMock()

    with patch(
        "uniffy.domains.permissions.access_request_notifications.publish_access_request_changed",
        publish,
    ):
        await AccessRequestNotifier(MagicMock()).publish_state(request)

    publish.assert_awaited_once_with(
        user_id=request.requester_id,
        request_id=request.id,
        requested_urn=request.requested_urn,
        state=ACCESS_REQUEST_STATE_DENIED,
        can_request_again_at=responded_at + timedelta(hours=24),
    )


async def test_private_chat_request_deduplicates_active_channel_owners() -> None:
    request = _request()
    request.original_content_type = ContentType.CHAT_MESSAGE
    request.canonical_content_type = ContentType.CHAT
    owner_a = generate_id()
    owner_b = generate_id()
    result = MagicMock()
    result.scalars.return_value = [owner_a, owner_b, owner_a]
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    target = AccessRequestTarget(
        requested_urn=request.requested_urn,
        original_content_type=ContentType.CHAT_MESSAGE,
        original_content_id=request.original_content_id,
        canonical_content_type=ContentType.CHAT,
        canonical_content_id=generate_id(),
        grant_kind=AccessGrantKind.CHAT,
        canonical_row=SimpleNamespace(owner_id=generate_id()),
    )

    recipients = await AccessRequestNotifier(session)._review_recipients(request, target)

    assert recipients == [owner_a, owner_b]

