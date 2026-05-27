"""Public entry point for every outbound mail caller (ARQ task, admin RPCs)."""

from __future__ import annotations

import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from email.message import EmailMessage
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.mail.backends import build_backend
from uniffy.core.mail.backends.base import MailResult
from uniffy.core.mail.config import MailConfig
from uniffy.core.mail.errors import (
    MailProviderError,
    MailSuppressedError,
)
from uniffy.core.mail.metrics import (
    MAIL_RATE_LIMITED_TOTAL,
    MAIL_SEND_DURATION_SECONDS,
    MAIL_SENT_TOTAL,
    MAIL_SUPPRESSED_TOTAL,
)
from uniffy.core.mail.rate_limit import check_send_rate_limit
from uniffy.core.mail.rendering import render_template
from uniffy.core.mail.resolver import MailConfigResolver
from uniffy.core.mail.suppression import SuppressionRepository, _normalize
from uniffy.core.mail.templates import get_template
from uniffy.db.session import open_session

SessionFactory = Callable[[], AbstractAsyncContextManager[Any]]


class MailSender:
    """Dispatch pipeline: resolve config, check suppression, rate limit, render, send, audit."""

    def __init__(self, session_factory: SessionFactory | None = None) -> None:
        self._session_factory: SessionFactory = session_factory or open_session

    async def send(
        self,
        *,
        recipient_email: str,
        template_name: str,
        context: dict[str, Any],
        organization_id: UUID | None = None,
        idempotency_key: str | None = None,
        user_id: UUID | None = None,
    ) -> MailResult:
        """Render ``template_name`` and dispatch through the resolved backend.

        Audit rows are the only forensics source - ``mail.sent`` on success,
        ``mail.send_failed`` on backend rejection, ``mail.suppressed`` when the
        recipient is suppressed. Audit writes use a fresh session because the
        SMTP submission has already happened; failures are logged and swallowed.

        ``organization_id=None`` forces the system env config (pre-org password
        resets, platform announcements).
        """
        recipient = _normalize(recipient_email)
        get_template(template_name)

        started = time.perf_counter()
        config: MailConfig
        async with self._session_factory() as session:
            config = await MailConfigResolver(session).resolve(organization_id)

            suppression = SuppressionRepository(session)
            if await suppression.is_suppressed(recipient):
                MAIL_SUPPRESSED_TOTAL.labels(template=template_name).inc()
                await self._audit(
                    session=session,
                    action=Action.MAIL_SUPPRESSED,
                    organization_id=organization_id,
                    user_id=user_id,
                    template=template_name,
                    recipient=recipient,
                    config_source=config.source,
                    error="recipient on suppression list",
                )
                await session.commit()
                raise MailSuppressedError(
                    f"Recipient {recipient!r} is on the global suppression list",
                    details={"recipient": recipient, "template": template_name},
                )

        scope = str(organization_id) if organization_id is not None else "system"
        scope_kind = "org" if organization_id is not None else "system"
        try:
            await check_send_rate_limit(scope, config.rate_limit_per_min)
        except Exception:
            MAIL_RATE_LIMITED_TOTAL.labels(scope_kind=scope_kind).inc()
            raise

        rendered = await render_template(template_name, context)
        message = _compose(
            config=config,
            recipient=recipient,
            subject=rendered.subject,
            html=rendered.html,
            text=rendered.text,
        )

        backend = build_backend(config)
        result = await backend.send(message, idempotency_key=idempotency_key)

        elapsed = time.perf_counter() - started
        MAIL_SEND_DURATION_SECONDS.labels(
            template=template_name,
            config_source=config.source,
        ).observe(elapsed)

        if result.success:
            MAIL_SENT_TOTAL.labels(
                template=template_name,
                status="sent",
                config_source=config.source,
            ).inc()
            logger.info(
                "mail sent",
                component="mail",
                template=template_name,
                recipient=recipient,
                config_source=config.source,
                provider_message_id=result.provider_message_id,
                user_id=str(user_id) if user_id else None,
            )
            await self._record_audit(
                action=Action.MAIL_SENT,
                organization_id=organization_id,
                user_id=user_id,
                template=template_name,
                recipient=recipient,
                config_source=config.source,
                provider_message_id=result.provider_message_id,
            )
            return result

        MAIL_SENT_TOTAL.labels(
            template=template_name,
            status="failed",
            config_source=config.source,
        ).inc()
        logger.warning(
            "mail send failed",
            component="mail",
            template=template_name,
            recipient=recipient,
            config_source=config.source,
            error=result.error,
        )
        await self._record_audit(
            action=Action.MAIL_SEND_FAILED,
            organization_id=organization_id,
            user_id=user_id,
            template=template_name,
            recipient=recipient,
            config_source=config.source,
            error=result.error,
        )
        raise MailProviderError(
            result.error or "SMTP send failed without an error message",
            details={"template": template_name, "config_source": config.source},
        )

    @staticmethod
    async def _audit(
        *,
        session,
        action: str,
        organization_id: UUID | None,
        user_id: UUID | None,
        template: str,
        recipient: str,
        config_source: str,
        provider_message_id: str | None = None,
        error: str | None = None,
    ) -> None:
        """Add one ``audit_events`` row to the caller's session; caller commits."""
        details: dict[str, Any] = {
            "template": template,
            "recipient": recipient,
            "config_source": config_source,
        }
        if provider_message_id is not None:
            details["provider_message_id"] = provider_message_id
        if error is not None:
            details["error"] = error
        await write_audit_event(
            session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=action,
            resource_type="email",
            details=details,
        )

    async def _record_audit(
        self,
        *,
        action: str,
        organization_id: UUID | None,
        user_id: UUID | None,
        template: str,
        recipient: str,
        config_source: str,
        provider_message_id: str | None = None,
        error: str | None = None,
    ) -> None:
        """Persist one audit row for the send in a fresh session; failures are swallowed."""
        try:
            async with self._session_factory() as session:
                await self._audit(
                    session=session,
                    action=action,
                    organization_id=organization_id,
                    user_id=user_id,
                    template=template,
                    recipient=recipient,
                    config_source=config_source,
                    provider_message_id=provider_message_id,
                    error=error,
                )
                await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "audit write failed for mail send",
                component="mail",
                action=action,
                template=template,
            )


def _compose(
    *,
    config: MailConfig,
    recipient: str,
    subject: str,
    html: str,
    text: str,
) -> EmailMessage:
    """Multi-part ``EmailMessage`` from rendered template and config envelope metadata."""
    message = EmailMessage()
    message["Subject"] = subject
    message["To"] = recipient
    if config.from_name:
        message["From"] = f"{config.from_name} <{config.from_address}>"
    else:
        message["From"] = config.from_address
    if config.reply_to:
        message["Reply-To"] = config.reply_to
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


__all__ = ["MailSender"]
