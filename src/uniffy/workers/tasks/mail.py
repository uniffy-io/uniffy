"""ARQ task that dispatches one transactional email.

Every outbound mail flows through this task. Domain code enqueues
``send_email`` with the template name and a JSON-encoded render
context; the worker resolves the org's ``MailConfig``, renders, and
hands off to ``SmtpBackend``.

Retry semantics:

* ``MailRateLimitedError`` -> ``Retry(defer=job_try * 30s)``
* ``MailProviderError``    -> ``Retry(defer=job_try * 60s)``
* ``MailSuppressedError`` / ``MailNotConfiguredError`` -> terminal,
  no retry (surfaced as ``{"status": "...", ...}``).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from arq import Retry
from loguru import logger

from uniffy.core.mail import (
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSender,
    MailSuppressedError,
)

_sender: MailSender | None = None


def _get_sender() -> MailSender:
    """Return the process-wide ``MailSender`` (lazy so workers without mail boot)."""
    global _sender
    if _sender is None:
        _sender = MailSender()
    return _sender


async def send_email(
    ctx: dict[str, Any],
    recipient_email: str,
    template_name: str,
    context_json: str,
    *,
    organization_id: str | None = None,
    idempotency_key: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Render and dispatch one email via ``MailSender``.

    Parameters
    ----------
    recipient_email
        Address to send to.
    template_name
        Must appear in the ``TEMPLATES`` registry.
    context_json
        JSON-encoded render context dict. ARQ only accepts JSON-safe
        arguments, so callers serialise once and the worker decodes.
    organization_id
        Stringified UUID. ``None`` forces the system env config.
    idempotency_key
        Caller-supplied dedupe handle. Currently informational only
        (SMTP has no provider-side dedupe header).
    user_id
        Stringified UUID, used only for log breadcrumbs.
    """
    try:
        context = json.loads(context_json)
    except json.JSONDecodeError:
        logger.error("send_email: context_json is not valid JSON", component="mail")
        return {"status": "failed", "reason": "invalid_context_json"}

    org_uuid = UUID(organization_id) if organization_id else None
    user_uuid = UUID(user_id) if user_id else None
    sender = _get_sender()

    try:
        result = await sender.send(
            recipient_email=recipient_email,
            template_name=template_name,
            context=context,
            organization_id=org_uuid,
            idempotency_key=idempotency_key,
            user_id=user_uuid,
        )
    except MailSuppressedError as exc:
        return {"status": "suppressed", "reason": exc.message}
    except MailNotConfiguredError as exc:
        return {"status": "skipped", "reason": "not_configured", "detail": exc.message}
    except MailRateLimitedError:
        raise Retry(defer=ctx["job_try"] * 30)
    except MailProviderError as exc:
        logger.warning(
            "send_email: provider error, retrying",
            component="mail",
            template=template_name,
            recipient=recipient_email,
            error=exc.message,
        )
        raise Retry(defer=ctx["job_try"] * 60)

    return {
        "status": "sent",
        "provider_message_id": result.provider_message_id,
    }
