"""The notification stream is an org-wide broadcast surface.

The gate binds the requested org to the JWT claim and to an active
membership before any channel subscription, and a live stream re-reads
the cached membership decision on the realtime cadence so removal or
deactivation terminates it without waiting for token expiry.
"""

import ast
import inspect
import textwrap
from unittest.mock import AsyncMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.method import IdempotencyLevel, MethodInfo
from connectrpc.request import Headers, RequestContext
from uniffy_proto.notifications.v1.notifications_pb2 import (
    StreamNotificationsRequest,
    StreamNotificationsResponse,
)

from uniffy.core.types import generate_id
from uniffy.core.valkey import NotificationPayloadType
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.domains.notifications.handlers import NotificationsHandlers

USER = generate_id()
ORG_A = generate_id()
ORG_B = generate_id()


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch):
    # The unit tier signs its own token: it must not depend on a developer's .env.
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")


def _token(organization_id=None) -> str:
    from uniffy.core.auth.tokens import create_access_token

    return create_access_token(USER, organization_id=organization_id)


def _ctx(token: str) -> RequestContext:
    headers = Headers()
    headers["authorization"] = f"Bearer {token}"
    return RequestContext(
        method=MethodInfo(
            name="StreamNotifications",
            service_name="notifications.v1.NotificationsService",
            input=StreamNotificationsRequest,
            output=StreamNotificationsResponse,
            idempotency_level=IdempotencyLevel.UNKNOWN,
        ),
        http_method="POST",
        request_headers=headers,
    )


def _fake_subscription(events):
    """A stand-in for subscribe_channels that records the channel names."""

    async def _events():
        for event in events:
            yield event

    calls: dict[str, tuple[str, ...]] = {}

    def fake(*channels: str):
        calls["channels"] = channels
        return _events()

    return fake, calls


async def _consume(stream) -> list[StreamNotificationsResponse]:
    return [response async for response in stream]


async def _stream(request: StreamNotificationsRequest, token: str):
    ctx = _ctx(token)
    interceptor = AuthenticationInterceptor()
    reset_token = await interceptor.on_start(ctx)
    try:
        async for response in NotificationsHandlers().stream_notifications(request, ctx):
            yield response
    finally:
        await interceptor.on_end(reset_token, ctx, None)


async def test_a_token_bound_to_org_a_cannot_stream_org_b() -> None:
    member = AsyncMock(return_value=True)
    fake, calls = _fake_subscription([])

    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", member),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        with pytest.raises(ConnectError) as exc_info:
            await _consume(
                _stream(StreamNotificationsRequest(organization_id=str(ORG_B)), _token(ORG_A))
            )

    assert exc_info.value.code == Code.PERMISSION_DENIED
    member.assert_not_awaited()
    assert "channels" not in calls


async def test_an_active_member_streams_on_the_jwt_resolved_org() -> None:
    """An empty request field resolves from the JWT claim, so every channel
    name is derived from the authenticated org rather than request input.
    """
    member = AsyncMock(return_value=True)
    fake, calls = _fake_subscription([{"id": "n-1", "title": "hi", "notification_type": 0}])

    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", member),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        responses = await _consume(
            _stream(StreamNotificationsRequest(organization_id=""), _token(ORG_A))
        )

    member.assert_awaited_once_with(USER, ORG_A)
    assert calls["channels"] == (
        f"notifications:{USER}",
        f"presence:{ORG_A}",
        f"mentions:{ORG_A}",
        f"tags:{ORG_A}",
        f"content:{ORG_A}",
    )
    assert len(responses) == 1
    assert responses[0].event_type == StreamNotificationsResponse.EVENT_TYPE_NEW_NOTIFICATION
    assert responses[0].notification.id == "n-1"


async def test_a_removed_or_deactivated_member_is_denied_before_subscription() -> None:
    """The personal notifications channel is also behind the org gate."""
    member = AsyncMock(return_value=False)
    fake, calls = _fake_subscription([])

    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", member),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        with pytest.raises(ConnectError) as exc_info:
            await _consume(
                _stream(StreamNotificationsRequest(organization_id=str(ORG_A)), _token(ORG_A))
            )

    assert exc_info.value.code == Code.PERMISSION_DENIED
    member.assert_awaited_once_with(USER, ORG_A)
    assert "channels" not in calls


async def test_an_orgless_token_selects_an_org_only_with_active_enrollment() -> None:
    fake, calls = _fake_subscription([])
    request = StreamNotificationsRequest(organization_id=str(ORG_B))

    denied = AsyncMock(return_value=False)
    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", denied),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        with pytest.raises(ConnectError) as exc_info:
            await _consume(_stream(request, _token()))

    assert exc_info.value.code == Code.PERMISSION_DENIED
    denied.assert_awaited_once_with(USER, ORG_B)
    assert "channels" not in calls

    enrolled = AsyncMock(return_value=True)
    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", enrolled),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        responses = await _consume(_stream(request, _token()))

    assert responses == []
    enrolled.assert_awaited_once_with(USER, ORG_B)
    assert calls["channels"][1] == f"presence:{ORG_B}"


async def test_a_non_member_system_admin_gets_no_bypass() -> None:
    """is_system_admin lives in PostgreSQL, not the token; the gate never
    reads it, so a platform admin without an active membership is an
    ordinary non-member here.
    """
    member = AsyncMock(return_value=False)
    fake, calls = _fake_subscription([])

    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", member),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
    ):
        with pytest.raises(ConnectError) as exc_info:
            await _consume(
                _stream(StreamNotificationsRequest(organization_id=str(ORG_A)), _token(ORG_A))
            )

    assert exc_info.value.code == Code.PERMISSION_DENIED
    assert "channels" not in calls


def test_the_stream_gate_consults_membership_only() -> None:
    """Neither is_system_admin nor a SupportSession may open the org-wide
    broadcast channels; the handler must not grow such a branch.
    """
    source = textwrap.dedent(inspect.getsource(NotificationsHandlers.stream_notifications))
    tree = ast.parse(source)
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    attrs = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}

    assert "is_active_member" in names
    forbidden = {"is_system_admin", "SupportSession", "support_session", "effective_role"}
    assert not forbidden & (names | attrs)


async def test_a_live_stream_terminates_after_membership_revocation() -> None:
    """Poll ticks re-read the cached membership decision; the second read
    reflects the revocation and closes the stream with a typed denial.
    """
    member = AsyncMock(side_effect=[True, False])
    fake, _calls = _fake_subscription([None, None, None])

    with (
        patch("uniffy.domains.notifications.handlers.is_active_member", member),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
        patch("uniffy.domains.notifications.handlers.REAUTH_INTERVAL_SECONDS", 0),
    ):
        with pytest.raises(ConnectError) as exc_info:
            await _consume(
                _stream(StreamNotificationsRequest(organization_id=str(ORG_A)), _token(ORG_A))
            )

    assert exc_info.value.code == Code.PERMISSION_DENIED
    assert member.await_count == 2


async def test_every_mention_state_event_passes_the_recipient_gate() -> None:
    payload = {
        "_type": NotificationPayloadType.MENTION_STATE_CHANGED,
        "urn": f"urn:uniffy:content:NOTE:{generate_id()}",
        "changes": {"name": "private"},
    }
    fake, _calls = _fake_subscription([payload])
    relay = AsyncMock()
    relay.allows_mention_state.return_value = False

    with (
        patch(
            "uniffy.domains.notifications.handlers.is_active_member",
            AsyncMock(return_value=True),
        ),
        patch("uniffy.domains.notifications.handlers.subscribe_channels", fake),
        patch("uniffy.domains.notifications.handlers.TagEventRelay", return_value=relay),
    ):
        responses = await _consume(
            _stream(StreamNotificationsRequest(organization_id=str(ORG_A)), _token(ORG_A))
        )

    assert responses == []
    relay.allows_mention_state.assert_awaited_once_with(payload)
