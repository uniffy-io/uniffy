"""The user chat stream passes on only the events of the organization it serves."""

from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from uniffy_proto.chat.v1.chat_stream_pb import (
    ChatEventType,
    StreamUserChatEventsRequest,
    UserChatEventType,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.types import generate_id
from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.chat.streaming import handlers as handlers_module
from uniffy.domains.chat.streaming.handlers import ChatStreamHandlers
from uniffy.domains.chat.streaming.scope import ChannelOrganizationFilter


class _Channels:
    def __init__(self, organizations: dict[UUID, UUID]) -> None:
        self._organizations = organizations
        self.calls: list[UUID] = []

    async def lookup(self, channel_id: UUID) -> UUID | None:
        self.calls.append(channel_id)
        return self._organizations.get(channel_id)


async def test_filter_admits_only_channels_of_its_organization() -> None:
    own_org, other_org = generate_id(), generate_id()
    own_channel, other_channel = generate_id(), generate_id()
    channels = _Channels({own_channel: own_org, other_channel: other_org})
    scope = ChannelOrganizationFilter(own_org, lookup=channels.lookup)

    assert await scope.admits({"channel_id": str(own_channel)})
    assert not await scope.admits({"channel_id": str(other_channel)})
    assert await scope.admits({"channel_id": str(own_channel)})
    assert not await scope.admits({"channel_id": str(other_channel)})
    assert channels.calls == [own_channel, other_channel]


async def test_filter_refuses_events_it_cannot_place() -> None:
    channels = _Channels({})
    scope = ChannelOrganizationFilter(generate_id(), lookup=channels.lookup)

    assert not await scope.admits({})
    assert not await scope.admits({"channel_id": ""})
    assert not await scope.admits({"channel_id": "not-a-uuid"})
    assert channels.calls == []


async def test_filter_looks_up_a_missing_channel_again() -> None:
    own_org, channel_id = generate_id(), generate_id()
    organizations: dict[UUID, UUID] = {}
    channels = _Channels(organizations)
    scope = ChannelOrganizationFilter(own_org, lookup=channels.lookup)

    assert not await scope.admits({"channel_id": str(channel_id)})
    organizations[channel_id] = own_org
    assert await scope.admits({"channel_id": str(channel_id)})
    assert channels.calls == [channel_id, channel_id]


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


async def test_stream_drops_events_of_other_organizations(
    monkeypatch: pytest.MonkeyPatch,
    principal_org: UUID,
) -> None:
    own_channel, other_channel = generate_id(), generate_id()
    channels = _Channels({own_channel: principal_org, other_channel: generate_id()})
    payloads: list[dict[str, Any]] = [
        {"_type": evt.CHANNEL_CREATED, "channel_id": str(other_channel)},
        {
            "_type": evt.UNREAD_COUNT_CHANGED,
            "channel_id": str(other_channel),
            "unread_count": 1,
        },
        {"_type": evt.CHANNEL_CREATED, "channel_id": str(own_channel)},
        {
            "_type": evt.UNREAD_COUNT_CHANGED,
            "channel_id": str(own_channel),
            "unread_count": 2,
        },
    ]

    async def subscribe(*_channels: str) -> AsyncIterator[dict[str, Any]]:
        for payload in payloads:
            yield payload

    monkeypatch.setattr(handlers_module, "subscribe_channels", subscribe)
    monkeypatch.setattr(
        handlers_module,
        "ChannelOrganizationFilter",
        lambda organization_id: ChannelOrganizationFilter(organization_id, lookup=channels.lookup),
    )

    received = [
        event
        async for event in ChatStreamHandlers().stream_user_chat_events(
            StreamUserChatEventsRequest(organization_id=str(principal_org)),
            MagicMock(),
        )
    ]

    assert [event.event_type for event in received] == [
        UserChatEventType.CHANNEL_EVENT,
        UserChatEventType.UNREAD_COUNT_CHANGED,
    ]
    assert received[0].payload.value.event_type == ChatEventType.CHANNEL_CREATED
    assert received[0].payload.value.channel_id == str(own_channel)
    assert received[1].payload.value.channel_id == str(own_channel)
