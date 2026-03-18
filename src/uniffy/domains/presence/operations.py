"""Presence operations - ephemeral state in Valkey, custom status in PostgreSQL."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.valkey.presence import (
    presence_get_bulk,
    presence_publish_change,
    presence_set,
)


class PresenceOperations:
    """Presence operations.

    Ephemeral presence state (online/away/dnd/offline) is stored in Valkey
    with a 120s TTL. Custom statuses (emoji + text + expiry) are stored
    on the settings_profiles table in PostgreSQL.

    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize with database session for custom status operations."""
        self.session = session

    async def set_presence(
        self,
        user_id: UUID,
        organization_id: UUID,
        status: str,
        client: str,
    ) -> None:
        """Set user presence state and publish change if status differs.

        Parameters
        ----------
        user_id : UUID
            The user setting their presence.
        organization_id : UUID
            Organization scope.
        status : str
            Presence status ("online", "away", "dnd", "offline").
        client : str
            Client type ("web", "mobile", "desktop").

        """
        previous = await presence_set(organization_id, user_id, status, client)
        if previous is not None:
            # Status changed or first heartbeat - publish with custom status
            custom = await self._get_custom_status(user_id)
            last_active = datetime.now(UTC).isoformat()
            await presence_publish_change(organization_id, user_id, status, last_active, custom)

    async def get_bulk_presence(
        self,
        organization_id: UUID,
        user_ids: list[UUID],
    ) -> dict[str, dict[str, Any]]:
        """Get presence for multiple users, merging Valkey state with custom statuses.

        Parameters
        ----------
        organization_id : UUID
            Organization scope.
        user_ids : list[UUID]
            User IDs to query (max 200).

        Returns
        -------
        dict[str, dict]
            Mapping of user_id to presence data including custom_status.

        """
        valkey_data = await presence_get_bulk(organization_id, user_ids)

        # Merge custom statuses for users who have presence in Valkey
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
        """Set custom status on the user's default settings profile.

        Parameters
        ----------
        user_id : UUID
            The user setting their custom status.
        organization_id : UUID | None
            Organization scope (for publishing the change).
        emoji : str
            Emoji character or shortcode.
        text : str
            Status text.
        expires_at : datetime | None
            Optional expiry time.

        Returns
        -------
        dict
            The custom status data that was set.

        """
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

        # Publish change so other users see the update in real-time
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
        """Clear custom status from the user's default settings profile.

        Parameters
        ----------
        user_id : UUID
            The user clearing their custom status.
        organization_id : UUID | None
            Organization scope (for publishing the change).

        """
        await self.session.execute(
            update(SettingsProfile)
            .where(
                SettingsProfile.user_id == user_id,
                SettingsProfile.is_default.is_(True),
            )
            .values(custom_status=None)
        )
        await self.session.commit()

        # Publish change so other users see the cleared status
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
        """Get custom status from the user's default settings profile.

        Parameters
        ----------
        user_id : UUID
            User to query.

        Returns
        -------
        dict | None
            Custom status data or None if not set.

        """
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
        """Get custom statuses for multiple users in one query.

        Parameters
        ----------
        user_ids : list[UUID]
            User IDs to query.

        Returns
        -------
        dict[str, dict]
            Mapping of user_id (str) to custom status data.

        """
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
