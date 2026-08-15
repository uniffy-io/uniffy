"""Settings profile CRUD + effective-settings computation."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.settings.defaults import (
    get_appearance_defaults_dict,
    get_effective_appearance,
    get_effective_keyboard_shortcuts,
    get_effective_notifications,
    get_keyboard_shortcuts_defaults_dict,
    get_notifications_defaults_dict,
)

_WEEK_START_VALUES = {"monday", "saturday", "sunday"}


def _validate_appearance(appearance: dict[str, Any] | None) -> None:
    if not appearance:
        return
    tz = appearance.get("timezone")
    if tz:
        try:
            ZoneInfo(tz)
        except (KeyError, ValueError) as exc:
            raise ValidationError("timezone", f"Unknown timezone '{tz}'") from exc
    week_start = appearance.get("week_start")
    if week_start and week_start not in _WEEK_START_VALUES:
        raise ValidationError("week_start", f"Unknown week start '{week_start}'")


async def get_user_timezone(session: AsyncSession, user_id: UUID) -> str | None:
    """Stored display timezone from the user's default profile; None = automatic."""
    profile = await SettingsOperations(session).get_default_profile(user_id)
    if not profile or not profile.appearance:
        return None
    return profile.appearance.get("timezone") or None


class SettingsOperations:
    """Merges per-profile overrides on top of defaults."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_profile(
        self,
        user_id: UUID,
        name: str,
        appearance: dict[str, Any] | None = None,
        keyboard_shortcuts: dict[str, Any] | None = None,
        notifications: dict[str, Any] | None = None,
        is_default: bool = False,
    ) -> SettingsProfile:
        existing = await self._get_profile_by_name(user_id, name)
        if existing:
            raise ValidationError("name", f"Profile with name '{name}' already exists")

        _validate_appearance(appearance)

        if is_default:
            await self._unset_default_profiles(user_id)

        profile = SettingsProfile(
            user_id=user_id,
            name=name,
            appearance=appearance,
            keyboard_shortcuts=keyboard_shortcuts,
            notifications=notifications,
            is_default=is_default,
        )

        self.session.add(profile)
        await self.session.commit()
        await self.session.refresh(profile)

        return profile

    async def get_profile(
        self,
        user_id: UUID,
        profile_id: UUID,
    ) -> SettingsProfile:
        """
        Get a settings profile by ID.

        Parameters
        ----------
        user_id : UUID
            The user ID (for authorization).
        profile_id : UUID
            The profile ID.

        Returns
        -------
        SettingsProfile
            The requested profile.

        Raises
        ------
        NotFoundError
            If the profile doesn't exist or doesn't belong to the user.

        """
        result = await self.session.execute(
            select(SettingsProfile).where(
                and_(
                    SettingsProfile.id == profile_id,
                    SettingsProfile.user_id == user_id,
                )
            )
        )
        profile = result.scalars().first()

        if not profile:
            raise NotFoundError("SettingsProfile", profile_id)

        return profile

    async def update_profile(
        self,
        user_id: UUID,
        profile_id: UUID,
        name: str | None = None,
        appearance: dict[str, Any] | None = None,
        keyboard_shortcuts: dict[str, Any] | None = None,
        notifications: dict[str, Any] | None = None,
        is_default: bool | None = None,
    ) -> SettingsProfile:
        """Sparse update; JSONB fields merge with existing values."""
        profile = await self.get_profile(user_id, profile_id)

        if name is not None and name != profile.name:
            existing = await self._get_profile_by_name(user_id, name)
            if existing:
                raise ValidationError("name", f"Profile with name '{name}' already exists")
            profile.name = name

        if appearance is not None:
            _validate_appearance(appearance)
            profile.appearance = self._merge_settings(profile.appearance, appearance)

        if keyboard_shortcuts is not None:
            profile.keyboard_shortcuts = self._merge_settings(
                profile.keyboard_shortcuts, keyboard_shortcuts
            )

        if notifications is not None:
            profile.notifications = self._merge_settings(profile.notifications, notifications)

        if is_default is not None:
            if is_default and not profile.is_default:
                await self._unset_default_profiles(user_id)
            profile.is_default = is_default

        profile.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(profile)

        if notifications is not None:
            from uniffy.domains.notifications.cache import invalidate_cached_settings

            await invalidate_cached_settings(user_id)

        return profile

    async def delete_profile(
        self,
        user_id: UUID,
        profile_id: UUID,
    ) -> bool:
        """Refuses to delete the only profile."""
        profile = await self.get_profile(user_id, profile_id)

        count = await self._count_user_profiles(user_id)
        if count <= 1:
            raise ValidationError(
                "profile_id", "Cannot delete the only profile. Create another profile first."
            )

        await self.session.delete(profile)
        await self.session.commit()

        from uniffy.domains.notifications.cache import invalidate_cached_settings

        await invalidate_cached_settings(user_id)

        return True

    async def list_profiles(
        self,
        user_id: UUID,
    ) -> list[SettingsProfile]:
        result = await self.session.execute(
            select(SettingsProfile)
            .where(SettingsProfile.user_id == user_id)
            .order_by(SettingsProfile.is_default.desc(), SettingsProfile.name)
        )
        return list(result.scalars().all())

    async def get_default_profile(
        self,
        user_id: UUID,
    ) -> SettingsProfile | None:
        result = await self.session.execute(
            select(SettingsProfile).where(
                and_(
                    SettingsProfile.user_id == user_id,
                    SettingsProfile.is_default == True,  # noqa: E712
                )
            )
        )
        return result.scalars().first()

    async def get_or_create_default_profile(
        self,
        user_id: UUID,
    ) -> SettingsProfile:
        profile = await self.get_default_profile(user_id)
        if profile:
            return profile

        profiles = await self.list_profiles(user_id)
        if profiles:
            profiles[0].is_default = True
            await self.session.commit()
            await self.session.refresh(profiles[0])
            return profiles[0]

        # Concurrent callers can race here; rollback and return the winner's profile.
        try:
            return await self.create_profile(
                user_id=user_id,
                name="Default",
                is_default=True,
            )
        except IntegrityError, ValidationError:
            await self.session.rollback()
            profile = await self.get_default_profile(user_id)
            if profile:
                return profile
            raise

    async def set_default_profile(
        self,
        user_id: UUID,
        profile_id: UUID,
    ) -> SettingsProfile:
        profile = await self.get_profile(user_id, profile_id)

        if not profile.is_default:
            await self._unset_default_profiles(user_id)
            profile.is_default = True
            profile.updated_at = datetime.now(UTC)
            await self.session.commit()
            await self.session.refresh(profile)

        return profile

    def get_effective_settings(
        self,
        profile: SettingsProfile,
    ) -> dict[str, Any]:
        return {
            "appearance": get_effective_appearance(profile.appearance),
            "keyboard_shortcuts": get_effective_keyboard_shortcuts(profile.keyboard_shortcuts),
            "notifications": get_effective_notifications(profile.notifications),
        }

    def get_settings_schema(self) -> dict[str, Any]:
        return {
            "appearance_defaults": get_appearance_defaults_dict(),
            "keyboard_shortcuts_defaults": get_keyboard_shortcuts_defaults_dict(),
            "notifications_defaults": get_notifications_defaults_dict(),
        }

    async def _get_profile_by_name(
        self,
        user_id: UUID,
        name: str,
    ) -> SettingsProfile | None:
        result = await self.session.execute(
            select(SettingsProfile).where(
                and_(
                    SettingsProfile.user_id == user_id,
                    SettingsProfile.name == name,
                )
            )
        )
        return result.scalars().first()

    async def _unset_default_profiles(self, user_id: UUID) -> None:
        await self.session.execute(
            update(SettingsProfile)
            .where(SettingsProfile.user_id == user_id)
            .values(is_default=False)
        )

    async def _count_user_profiles(self, user_id: UUID) -> int:
        from sqlalchemy import func

        result = await self.session.execute(
            select(func.count())
            .select_from(SettingsProfile)
            .where(SettingsProfile.user_id == user_id)
        )
        return result.scalar() or 0

    @staticmethod
    def _merge_settings(
        existing: dict[str, Any] | None,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """``None`` values in updates remove the override (reset to default)."""
        if existing is None:
            existing = {}

        result = existing.copy()

        for key, value in updates.items():
            if value is None:
                result.pop(key, None)
            elif isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = {**result[key], **value}
            else:
                result[key] = value

        return result if result else None
