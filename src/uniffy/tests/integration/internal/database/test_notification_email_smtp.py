"""Notification events reach a real SMTP socket through the durable outbox."""

import asyncio
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select

from uniffy.core.events.bus import _event_to_json
from uniffy.core.events.types import NotificationEvent
from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.mail import MailConfig, MailSender
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import (
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.types import NotificationType
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS_CTX_KEY
from uniffy.domains.notifications.delivery.base import NotificationChannel
from uniffy.domains.notifications.delivery.email import EmailAdapter
from uniffy.domains.notifications.delivery.app import InAppAdapter
from uniffy.domains.notifications.jobs.jobs import process_notification_event
from uniffy.domains.notifications.jobs.email import send_notification_email
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


class SmtpCapture:
    def __init__(self) -> None:
        self.messages: list[bytes] = []
        self.received = asyncio.Event()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writer.write(b"220 localhost ESMTP ready\r\n")
        await writer.drain()
        try:
            while line := await reader.readline():
                command = line.split(maxsplit=1)[0].upper()
                if command in {b"EHLO", b"HELO"}:
                    writer.write(b"250-localhost\r\n250 SIZE 10485760\r\n")
                elif command in {b"MAIL", b"RCPT", b"RSET", b"NOOP"}:
                    writer.write(b"250 2.0.0 ok\r\n")
                elif command == b"DATA":
                    writer.write(b"354 end with <CRLF>.<CRLF>\r\n")
                    await writer.drain()
                    payload = bytearray()
                    while data_line := await reader.readline():
                        if data_line == b".\r\n":
                            break
                        payload.extend(data_line[1:] if data_line.startswith(b"..") else data_line)
                    self.messages.append(bytes(payload))
                    self.received.set()
                    writer.write(b"250 2.0.0 queued as capture-1\r\n")
                elif command == b"QUIT":
                    writer.write(b"221 2.0.0 bye\r\n")
                    await writer.drain()
                    break
                else:
                    writer.write(b"502 5.5.2 command not implemented\r\n")
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()


async def test_event_outbox_worker_and_smtp_rendering(session, env) -> None:
    capture = SmtpCapture()
    server = await asyncio.start_server(capture.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    event = NotificationEvent(
        notification_type=NotificationType.SYSTEM_ANNOUNCEMENT,
        organization_id=env.org_id,
        actor_id=env.member_id,
        title="Quarterly <review>",
        body="See [[[Launch plan|urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca]]]",
        target_user_ids=[env.admin_id],
    )
    user = await session.get(User, env.admin_id)
    organization = await session.get(Organization, env.org_id)
    assert user is not None
    assert organization is not None
    user.email_verified = True
    await session.commit()

    config = MailConfig(
        from_address="no-reply@test.local",
        smtp_host="127.0.0.1",
        smtp_port=port,
        smtp_use_tls=False,
    )
    enqueue = AsyncMock(return_value=True)
    try:
        async with server:
            with patch.object(EmailAdapter, "enqueue_if_due", enqueue):
                processed = await process_notification_event(
                    {
                        SESSION_FACTORY_CTX_KEY: open_session,
                        DELIVERY_ADAPTERS_CTX_KEY: {
                            NotificationChannel.IN_APP: InAppAdapter(),
                            NotificationChannel.EMAIL: EmailAdapter(open_session),
                        },
                    },
                    _event_to_json(event),
                )

            delivery = (
                await session.execute(
                    select(NotificationEmailDelivery).where(
                        NotificationEmailDelivery.event_id == event.event_id
                    )
                )
            ).scalar_one()
            assert processed == {"status": "success", "recipients": 1, "in_app": 1}
            assert delivery.status == NotificationEmailStatus.PENDING

            with (
                patch(
                    "uniffy.core.mail.sender.MailConfigResolver.resolve",
                    new=AsyncMock(return_value=config),
                ),
                patch(
                    "uniffy.core.mail.sender.check_send_rate_limit",
                    new=AsyncMock(),
                ),
                patch(
                    "uniffy.domains.notifications.jobs.email._get_sender",
                    return_value=MailSender(),
                ),
            ):
                sent = await send_notification_email({}, str(delivery.id))

            await asyncio.wait_for(capture.received.wait(), timeout=2)
            await session.refresh(delivery)

        assert sent == {"status": "sent", "delivery_id": str(delivery.id)}
        assert delivery.status == NotificationEmailStatus.SENT
        assert len(capture.messages) == 1
        message = BytesParser(policy=policy.default).parsebytes(capture.messages[0])
        assert isinstance(message, EmailMessage)
        assert message["Subject"] == f"Quarterly <review> | {organization.name}"
        assert message["X-Idempotency-Key"] == f"notification/{event.event_id}/{env.admin_id}"
        text_body = message.get_body(preferencelist=("plain",)).get_content()
        html_body = message.get_body(preferencelist=("html",)).get_content()
        assert "See Launch plan" in text_body
        assert "/notifications" in text_body
        assert "Quarterly &lt;review&gt;" in html_body
    finally:
        await session.rollback()
        await session.execute(
            delete(NotificationEmailDelivery).where(
                NotificationEmailDelivery.event_id == event.event_id
            )
        )
        await session.execute(
            delete(Notification).where(
                Notification.organization_id == env.org_id,
                Notification.user_id == env.admin_id,
                Notification.title == event.title,
            )
        )
        user = await session.get(User, env.admin_id)
        if user is not None:
            user.email_verified = False
        await session.commit()
