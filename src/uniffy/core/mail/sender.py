"""Public entry point used by every outbound mail caller.

``MailSender.send`` runs the full pipeline -- config resolution,
suppression check, rate limit, template render, SMTP dispatch, metrics
emission -- and is the only thing the ARQ task / admin RPCs call. The
sender takes a session factory so the ARQ worker (which has no FastAPI
dependency cache) can pass ``open_session`` directly.
"""

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
    """Dispatch pipeline. Hold one instance per process or per request."""

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

        Dispatch pipeline (fail-fast at every step):

        1. **Resolve config** via ``MailConfigResolver``. Per-org row
           (``org_settings`` namespace ``mail``) wins; falls back to
           ``MailConfig.from_env()``; raises ``MailNotConfiguredError``
           when neither exists.
        2. **Suppression check** -- if ``recipient`` is on the global
           ``mail_suppressions`` list, write a ``mail.suppressed`` audit
           row and raise ``MailSuppressedError`` (terminal; ARQ task
           returns without retry).
        3. **Rate limit** -- Valkey fixed-window token bucket keyed on
           ``(org_id|"system", minute_window)`` with the resolved
           ``rate_limit_per_min``. Failure raises
           ``MailRateLimitedError`` (ARQ task converts to ``Retry``).
        4. **Render** the registered template into ``(subject, html, text)``;
           unknown ``template_name`` raises ``TemplateNotFoundError``.
        5. **Compose** an ``EmailMessage`` with HTML body + plaintext
           alternative, ``From`` = ``"<from_name> <from_address>"``,
           ``Reply-To`` if configured.
        6. **Submit** via ``SmtpBackend.send``. Provider error -> raise
           ``MailProviderError`` (ARQ task converts to ``Retry`` with
           backoff).

        Audit rows written by this method (single source of forensics --
        there is no separate ``mail_delivery_log`` table):

        * ``mail.sent`` on success, carries ``provider_message_id``.
        * ``mail.send_failed`` on backend rejection, carries ``error``.
        * ``mail.suppressed`` when the recipient is suppressed.

        Audit writes use a fresh session opened from ``session_factory``
        because the SMTP submission has already happened by then; a
        failed audit write is logged and swallowed (there is nothing
        left to undo).

        Parameters
        ----------
        recipient_email
            Address to send to. Lowercased before the suppression check
            so case-only variants on the suppression list match.
        template_name
            Must appear in the ``TEMPLATES`` allowlist; arbitrary file
            paths are rejected with ``TemplateNotFoundError`` -- the
            allowlist is the input-sanitization seam.
        context
            Render context. Templates use ``StrictUndefined`` so a
            missing key is a programmer error, not a silent blank.
        organization_id
            Drives config resolution. ``None`` forces the system env
            config (used for pre-org password resets and platform-level
            announcements). Pass the user's primary org for
            org-scoped flows so per-org SMTP branding applies.
        idempotency_key
            Caller-supplied dedupe handle. SMTP has no provider-side
            dedupe header, so this is currently informational and
            audit-only -- but the contract is in place for future
            provider-side support.
        user_id
            Logging + audit attribution only. The caller's domain audit
            row is the authoritative record of who initiated the send;
            ``mail.sent`` here is the dispatch artifact.
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
        """Write one ``audit_events`` row inside the caller's session.

        Caller is responsible for committing; this helper just adds the
        row so the audit + business write share a transaction when
        possible.
        """
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
        """Open a fresh session and persist one audit row for the send.

        The SMTP submission already happened by the time this runs, so
        a write failure here is logged-and-swallowed rather than
        propagated -- there is nothing left to undo.
        """
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
    """Build a multi-part ``EmailMessage`` from rendered + config inputs."""
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
