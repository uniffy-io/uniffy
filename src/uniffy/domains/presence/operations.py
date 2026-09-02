"""Presence operations - ephemeral state in Valkey, custom status in PostgreSQL."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.presence.state import (
    presence_get_bulk,
    presence_publish_change,
    presence_set,
)

logger = logger.bind(component="presence.operations")


class PresenceOperations:
    """Ephemeral presence in Valkey (120s TTL); custom status on ``settings_profiles``."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def set_presence(
        self,
        user_id: UUID,
        organization_id: UUID,
        status: str,
        client: str,
    ) -> None:
        previous = await presence_set(organization_id, user_id, status, client)
        if previous is not None:
            custom = await self._get_custom_status(user_id)
            last_active = datetime.now(UTC).isoformat()
            await presence_publish_change(organization_id, user_id, status, last_active, custom)

    async def get_bulk_presence(
        self,
        organization_id: UUID,
        user_ids: list[UUID],
    ) -> dict[str, dict[str, Any]]:
        valkey_data = await presence_get_bulk(organization_id, user_ids)

        if valkey_data:
            custom_statuses = await self._get_bulk_custom_statuses([
                UUID(uid) for uid in valkey_data
            ])
            for uid, custom in custom_statuses.items():
                if uid in valkey_data:
                    valkey_data[uid]["custom_status"] = custom

        return valkey_data

    async def set_custom_status(
        self,
        user_id: UUID,
        organization_id: UUID | None,
        emoji: str,
        text: str,
        expires_at: datetime | None,
    ) -> dict[str, Any]:
        custom_data: dict[str, Any] = {
            "emoji": emoji,
            "text": text,
        }
        if expires_at:
            custom_data["expires_at"] = expires_at.isoformat()

        result = await self.session.execute(
            update(SettingsProfile)
            .where(
                SettingsProfile.user_id == user_id,
                SettingsProfile.is_default.is_(True),
            )
            .values(custom_status=custom_data)
            .returning(SettingsProfile.id)
        )
        row = result.scalar_one_or_none()

        if row is None:
            logger.warning(
                f"No default settings profile found for user {user_id}, cannot set custom status"
            )
            return custom_data

        await self.session.commit()

        if organization_id:
            last_active = datetime.now(UTC).isoformat()
            await presence_publish_change(
                organization_id,
                user_id,
                "online",
                last_active,
                custom_data,
            )
        return custom_data

    async def clear_custom_status(
        self,
        user_id: UUID,
        organization_id: UUID | None,
    ) -> None:
        await self.session.execute(
            update(SettingsProfile)
            .where(
                SettingsProfile.user_id == user_id,
                SettingsProfile.is_default.is_(True),
            )
            .values(custom_status=None)
        )
        await self.session.commit()

        if organization_id:
            last_active = datetime.now(UTC).isoformat()
            await presence_publish_change(
                organization_id,
                user_id,
                "online",
                last_active,
                None,
            )

    async def _get_custom_status(self, user_id: UUID) -> dict[str, Any] | None:
        result = await self.session.execute(
            select(SettingsProfile.custom_status).where(
                SettingsProfile.user_id == user_id,
                SettingsProfile.is_default.is_(True),
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return row

    async def _get_bulk_custom_statuses(
        self,
        user_ids: list[UUID],
    ) -> dict[str, dict[str, Any]]:
        if not user_ids:
            return {}

        result = await self.session.execute(
            select(SettingsProfile.user_id, SettingsProfile.custom_status).where(
                SettingsProfile.user_id.in_(user_ids),
                SettingsProfile.is_default.is_(True),
                SettingsProfile.custom_status.isnot(None),
            )
        )
        rows = result.all()
        return {str(row.user_id): row.custom_status for row in rows}
