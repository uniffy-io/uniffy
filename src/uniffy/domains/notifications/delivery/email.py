"""Email delivery adapter; bridges ``NotificationEvent`` to the ``send_email`` ARQ task."""

from __future__ import annotations

import os
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.types import NotificationEvent
from uniffy.core.json_codec import dumps_str
from uniffy.core.mail import MailConfig
from uniffy.core.mail.config import MAIL_NAMESPACE
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.valkey.queue import QueueName, get_queue
from uniffy.db import open_session
from uniffy.domains.notifications.delivery.base import DeliveryAdapter, NotificationChannel
from uniffy.domains.settings.defaults import NOTIFICATIONS_DEFAULTS, EmailFrequency
from uniffy.workers.tasks import JobName

logger = logger.bind(component="mail")


async def _resolve_email_frequency(session: AsyncSession, user_id: UUID) -> EmailFrequency:
    """Return the user's effective email_frequency, defaulting to ``instant``."""
    result = await session.execute(
        select(SettingsProfile.notifications).where(
            SettingsProfile.user_id == user_id,
            SettingsProfile.is_default == True,  # noqa: E712
        )
    )
    overrides = result.scalar_one_or_none()
    if not overrides:
        return NOTIFICATIONS_DEFAULTS.email_frequency
    freq = overrides.get("email_frequency")
    if not isinstance(freq, str):
        return NOTIFICATIONS_DEFAULTS.email_frequency
    try:
        return EmailFrequency(freq)
    except ValueError:
        return NOTIFICATIONS_DEFAULTS.email_frequency


class EmailAdapter(DeliveryAdapter):
    """Bridge ``NotificationEvent`` -> ``send_email`` ARQ task."""

    @property
    def channel_name(self) -> NotificationChannel:
        return NotificationChannel.EMAIL

    async def startup(self) -> None:
        """Fail fast in production when neither env nor any per-org mail config exists."""
        if os.getenv("ENVIRONMENT", "development").lower() != "production":  # noqa: PLR2004
            return

        if MailConfig.from_env() is not None:
            return

        async with open_session() as session:
            row = (
                await session.execute(
                    select(OrgSetting).where(OrgSetting.namespace == MAIL_NAMESPACE).limit(1)
                )
            ).scalar_one_or_none()
            if row is not None:
                return

        raise RuntimeError(
            "EmailAdapter.startup: no MAIL_* env config and zero org_settings mail rows; "
            "configure system mail or add at least one per-org row before booting."
        )

    async def deliver(self, user_id: UUID, event: NotificationEvent) -> bool:
        # Digest-frequency users are handled by ``send_email_digest``; skip them here.
        async with open_session() as session:
            frequency = await _resolve_email_frequency(session, user_id)
            if frequency != EmailFrequency.INSTANT:
                return True

            user = await session.get(User, user_id)
            if user is None or not user.email or not user.email_verified:
                return False
            recipient = user.email
            display_name = user.full_name or user.username

        context = {
            "user_name": display_name,
            "title": event.title,
            "body": event.body,
            "source_urn": event.source_urn,
            "notification_type": event.notification_type.value,
        }
        idempotency_key = (
            f"notification/{event.notification_type.value}/{user_id}/{event.source_urn or 'noop'}"
        )

        try:
            queue = get_queue(QueueName.CORE)
        except RuntimeError:
            logger.warning(
                "email enqueue skipped: core queue not initialised",
                component="mail",
                user_id=str(user_id),
            )
            return False

        await queue.enqueue_job(
            JobName.SEND_EMAIL,
            recipient,
            "notifications/instant",
            dumps_str(context),
            organization_id=str(event.organization_id),
            idempotency_key=idempotency_key,
            user_id=str(user_id),
        )
        return True
