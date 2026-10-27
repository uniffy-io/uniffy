"""The notification stream passes on only the payloads of the organization it serves."""

from collections.abc import AsyncIterator, Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from uniffy_proto.notifications.v1.notifications_pb import (
    StreamNotificationsRequest,
    StreamNotificationsResponse,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.events import realtime
from uniffy.core.events.realtime import ContentAccessAction, NotificationPayloadType
from uniffy.core.types import generate_id
from uniffy.domains.notifications.handlers import NotificationsHandlers
from uniffy.domains.notifications.scope import NotificationOrganizationFilter
from uniffy.domains.tags.events import EVENT_TAG_CREATED

_HANDLERS = "uniffy.domains.notifications.handlers"
EventType = StreamNotificationsResponse.EventType


def _notification(organization_id: UUID, title: str) -> dict[str, Any]:
    return {"id": str(generate_id()), "title": title, "organization_id": str(organization_id)}


def test_filter_admits_only_payloads_of_its_organization() -> None:
    own_org, other_org = generate_id(), generate_id()
    scope = NotificationOrganizationFilter(own_org)

    assert scope.admits(_notification(own_org, "own"))
    assert not scope.admits(_notification(other_org, "other"))
    assert scope.admits({
        "_type": NotificationPayloadType.PERMISSIONS_CHANGED,
        "organization_id": str(own_org),
    })
    assert not scope.admits({
        "_type": NotificationPayloadType.ACCESS_REQUEST_CHANGED,
        "organization_id": str(other_org),
    })


def test_filter_refuses_payloads_it_cannot_place() -> None:
    scope = NotificationOrganizationFilter(generate_id())

    assert not scope.admits({})
    assert not scope.admits({"id": str(generate_id()), "title": "unstamped"})
    assert not scope.admits({"_type": NotificationPayloadType.FILE_UPDATED, "organization_id": ""})
    assert not scope.admits({"_type": "unknown", "organization_id": "not-a-uuid"})


@pytest.mark.parametrize(
    "event_type",
    [
        NotificationPayloadType.CONTENT_CHANGED,
        NotificationPayloadType.PRESENCE_CHANGED,
        NotificationPayloadType.MENTION_STATE_CHANGED,
        EVENT_TAG_CREATED,
    ],
)
def test_organization_channel_payloads_pass_without_a_stamp(event_type: str) -> None:
    assert NotificationOrganizationFilter(generate_id()).admits({"_type": event_type})


async def test_every_user_channel_publish_carries_its_organization() -> None:
    user_id, organization_id = generate_id(), generate_id()
    publish = AsyncMock()

    with patch.object(realtime, "publish_to_channel", publish):
        await realtime.publish_notification(
            user_id,
            {"_type": NotificationPayloadType.PERMISSIONS_CHANGED},
            organization_id=organization_id,
        )
        await realtime.publish_content_access_changed(
            content_type=8,
            content_id=generate_id(),
            action=ContentAccessAction.GRANTED,
            organization_id=organization_id,
        )

    assert [call.args[0] for call in publish.await_args_list] == [
        f"notifications:{user_id}",
        f"content:{organization_id}",
    ]
    assert {call.args[1]["organization_id"] for call in publish.await_args_list} == {
        str(organization_id)
    }


@pytest.fixture
def principal_org() -> Iterator[UUID]:
    organization_id = generate_id()
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=generate_id(),
            organization_id=organization_id,
            session_id=None,
            token_version=1,
            full_name="Alice",
            avatar_key="",
        )
    )
    try:
        yield organization_id
    finally:
        reset_current_principal(token)


async def test_stream_drops_payloads_of_other_organizations(principal_org: UUID) -> None:
    other_org = generate_id()
    payloads: list[dict[str, Any]] = [
        _notification(other_org, "other"),
        {
            "_type": NotificationPayloadType.FILE_UPDATED,
            "file_id": str(generate_id()),
            "organization_id": str(other_org),
        },
        {"_type": NotificationPayloadType.PERMISSIONS_CHANGED, "organization_id": str(other_org)},
        {"id": str(generate_id()), "title": "unstamped"},
        _notification(principal_org, "own"),
        {
            "_type": NotificationPayloadType.PERMISSIONS_CHANGED,
            "organization_id": str(principal_org),
        },
    ]

    async def subscribe(*_channels: str) -> AsyncIterator[dict[str, Any]]:
        for payload in payloads:
            yield payload

    with (
        patch(f"{_HANDLERS}.is_active_member", AsyncMock(return_value=True)),
        patch(f"{_HANDLERS}.subscribe_channels", subscribe),
    ):
        received = [
            event
            async for event in NotificationsHandlers().stream_notifications(
                StreamNotificationsRequest(organization_id=str(principal_org)), MagicMock()
            )
        ]

    assert [event.event_type for event in received] == [
        EventType.NEW_NOTIFICATION,
        EventType.PERMISSIONS_CHANGED,
    ]
    assert received[0].notification.title == "own"
    assert received[0].notification.organization_id == str(principal_org)


async def test_stream_heartbeats_during_foreign_organization_traffic(principal_org: UUID) -> None:
    other_org = generate_id()
    elapsed = 0.0

    async def subscribe(*_channels: str) -> AsyncIterator[dict[str, Any]]:
        nonlocal elapsed
        for tick in range(1, 181):
            elapsed = tick * 0.5
            yield _notification(other_org, "other")

    with (
        patch(f"{_HANDLERS}.time", SimpleNamespace(monotonic=lambda: elapsed)),
        patch(f"{_HANDLERS}.is_active_member", AsyncMock(return_value=True)),
        patch(f"{_HANDLERS}.subscribe_channels", subscribe),
    ):
        received = [
            event
            async for event in NotificationsHandlers().stream_notifications(
                StreamNotificationsRequest(organization_id=str(principal_org)), MagicMock()
            )
        ]

    assert [event.event_type for event in received] == [EventType.HEARTBEAT] * 3
