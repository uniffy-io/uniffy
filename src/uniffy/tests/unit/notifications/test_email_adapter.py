"""EmailAdapter: frequency gating + enqueue payload."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.events.types import NotificationEvent
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.delivery.email import EmailAdapter


def _event(org_id):
    return NotificationEvent(
        notification_type=NotificationType.CONTENT_MENTIONED,
        organization_id=org_id,
        actor_id=generate_id(),
        title="Jane mentioned you",
        body="See the planning doc",
        source_urn="urn:uniffy:content:NOTE:abc",
    )


@asynccontextmanager
async def _fake_session(session_mock):
    yield session_mock


class TestDeliver:
    async def test_instant_enqueues_send_email(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        session = AsyncMock()
        user_obj = MagicMock(
            email="USER@example.com",
            email_verified=True,
            full_name="Alice",
            username="alice",
        )
        session.get = AsyncMock(return_value=user_obj)

        queue = AsyncMock()
        with patch(
            "uniffy.domains.notifications.delivery.email._resolve_email_frequency",
            new=AsyncMock(return_value="instant"),
        ), patch(
            "uniffy.domains.notifications.delivery.email.open_session",
            new=lambda: _fake_session(session),
        ), patch(
            "uniffy.domains.notifications.delivery.email.get_queue",
            return_value=queue,
        ):
            adapter = EmailAdapter()
            ok = await adapter.deliver(user_id, _event(org_id))

        assert ok is True
        queue.enqueue_job.assert_called_once()
        args, kwargs = queue.enqueue_job.call_args
        assert args[0] == "send_email"
        assert args[1] == "USER@example.com"
        assert args[2] == "notifications/instant"
        assert kwargs["organization_id"] == str(org_id)
        assert kwargs["user_id"] == str(user_id)
        assert "notification/CONTENT_MENTIONED" in kwargs["idempotency_key"]

    async def test_hourly_returns_true_without_enqueue(self) -> None:
        session = AsyncMock()
        queue = AsyncMock()
        with patch(
            "uniffy.domains.notifications.delivery.email._resolve_email_frequency",
            new=AsyncMock(return_value="hourly"),
        ), patch(
            "uniffy.domains.notifications.delivery.email.open_session",
            new=lambda: _fake_session(session),
        ), patch(
            "uniffy.domains.notifications.delivery.email.get_queue",
            return_value=queue,
        ):
            adapter = EmailAdapter()
            ok = await adapter.deliver(generate_id(), _event(generate_id()))

        assert ok is True
        queue.enqueue_job.assert_not_called()

    async def test_unverified_user_skipped(self) -> None:
        session = AsyncMock()
        user_obj = MagicMock(email="x@y.com", email_verified=False)
        session.get = AsyncMock(return_value=user_obj)
        queue = AsyncMock()
        with patch(
            "uniffy.domains.notifications.delivery.email._resolve_email_frequency",
            new=AsyncMock(return_value="instant"),
        ), patch(
            "uniffy.domains.notifications.delivery.email.open_session",
            new=lambda: _fake_session(session),
        ), patch(
            "uniffy.domains.notifications.delivery.email.get_queue",
            return_value=queue,
        ):
            adapter = EmailAdapter()
            ok = await adapter.deliver(generate_id(), _event(generate_id()))

        assert ok is False
        queue.enqueue_job.assert_not_called()
