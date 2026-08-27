"""Send transactional email through the tenant-resolved mail pipeline."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.mail import (
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSender,
    MailSuppressedError,
)
from uniffy.vendor.arq import Retry

logger = logger.bind(component="mail.jobs")

_sender: MailSender | None = None


def _get_sender() -> MailSender:
    """Lazily-built process-wide `MailSender` so mail-less workers still boot."""
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
    try:
        context = loads(context_json)
    except JSONDecodeError:
        logger.error("send_email: context_json is not valid JSON")
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
            template=template_name,
            recipient=recipient_email,
            error=exc.message,
        )
        raise Retry(defer=ctx["job_try"] * 60)

    return {
        "status": "sent",
        "provider_message_id": result.provider_message_id,
    }
