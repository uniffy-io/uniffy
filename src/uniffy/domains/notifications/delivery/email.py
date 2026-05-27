"""Email delivery adapter; bridges ``NotificationEvent`` to the ``send_email`` ARQ task."""

from __future__ import annotations

import json
import os
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.types import NotificationEvent
from uniffy.core.mail import MailConfig
from uniffy.core.mail.config import MAIL_NAMESPACE
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.valkey.queue import get_queue
from uniffy.db import open_session
from uniffy.domains.notifications.delivery.base import DeliveryAdapter
from uniffy.domains.settings.defaults import NOTIFICATIONS_DEFAULTS


async def _resolve_email_frequency(session: AsyncSession, user_id: UUID) -> str:
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
    if not isinstance(freq, str) or freq not in ("instant", "hourly", "daily"):
        return NOTIFICATIONS_DEFAULTS.email_frequency
    return freq


class EmailAdapter(DeliveryAdapter):
    """Bridge ``NotificationEvent`` -> ``send_email`` ARQ task."""

    @property
    def channel_name(self) -> str:
        return "email"

    async def startup(self) -> None:
        """Fail fast in production when neither env nor any per-org mail config exists."""
        if os.getenv("ENVIRONMENT", "development").lower() != "production":
            return

        if MailConfig.from_env() is not None:
            return

        async with open_session() as session:
            row = (
                await session.execute(
                    select(OrgSetting)
                    .where(OrgSetting.namespace == MAIL_NAMESPACE)
                    .limit(1)
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
            if frequency != "instant":
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
            f"notification/{event.notification_type.value}/{user_id}/"
            f"{event.source_urn or 'noop'}"
        )

        try:
            queue = get_queue("core")
        except RuntimeError:
            logger.warning(
                "email enqueue skipped: core queue not initialised",
                component="mail",
                user_id=str(user_id),
            )
            return False

        await queue.enqueue_job(
            "send_email",
            recipient,
            "notifications/instant",
            json.dumps(context),
            organization_id=str(event.organization_id),
            idempotency_key=idempotency_key,
            user_id=str(user_id),
        )
        return True
