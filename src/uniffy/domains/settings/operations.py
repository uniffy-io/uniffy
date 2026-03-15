"""Settings operations for profile management.

This module handles all business logic for settings profiles including
CRUD operations and effective settings computation.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

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


class SettingsOperations:
    """
    Settings profile operations.

    Handles CRUD operations for user settings profiles and
    computes effective settings by merging defaults with overrides.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize settings operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
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
        """
        Create a new settings profile for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID who owns this profile.
        name : str
            Profile name (must be unique per user).
        appearance : dict | None
            Appearance overrides (sparse).
        keyboard_shortcuts : dict | None
            Keyboard shortcut overrides (sparse).
        notifications : dict | None
            Notification preference overrides (sparse).
        is_default : bool
            Whether to set this as the default profile.

        Returns
        -------
        SettingsProfile
            The created profile.

        Raises
        ------
        ValidationError
            If a profile with the same name already exists for this user.

        """
        # Check for duplicate name
        existing = await self._get_profile_by_name(user_id, name)
        if existing:
            raise ValidationError(f"Profile with name '{name}' already exists")

        # If setting as default, unset other defaults
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
        """
        Update an existing settings profile.

        Performs a sparse update - only provided fields are updated.
        For JSONB fields, values are merged with existing values.

        Parameters
        ----------
        user_id : UUID
            The user ID (for authorization).
        profile_id : UUID
            The profile ID to update.
        name : str | None
            New profile name.
        appearance : dict | None
            Appearance overrides to merge.
        keyboard_shortcuts : dict | None
            Keyboard shortcut overrides to merge.
        notifications : dict | None
            Notification overrides to merge.
        is_default : bool | None
            Whether to set as default.

        Returns
        -------
        SettingsProfile
            The updated profile.

        Raises
        ------
        NotFoundError
            If the profile doesn't exist or doesn't belong to the user.
        ValidationError
            If the new name conflicts with an existing profile.

        """
        profile = await self.get_profile(user_id, profile_id)

        # Check name uniqueness if changing
        if name is not None and name != profile.name:
            existing = await self._get_profile_by_name(user_id, name)
            if existing:
                raise ValidationError(f"Profile with name '{name}' already exists")
            profile.name = name

        # Merge JSONB fields (sparse update)
        if appearance is not None:
            profile.appearance = self._merge_settings(profile.appearance, appearance)

        if keyboard_shortcuts is not None:
            profile.keyboard_shortcuts = self._merge_settings(
                profile.keyboard_shortcuts, keyboard_shortcuts
            )

        if notifications is not None:
            profile.notifications = self._merge_settings(profile.notifications, notifications)

        # Handle default flag
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
        """
        Delete a settings profile.

        Parameters
        ----------
        user_id : UUID
            The user ID (for authorization).
        profile_id : UUID
            The profile ID to delete.

        Returns
        -------
        bool
            True if deleted successfully.

        Raises
        ------
        NotFoundError
            If the profile doesn't exist or doesn't belong to the user.
        ValidationError
            If trying to delete the only profile.

        """
        profile = await self.get_profile(user_id, profile_id)

        # Check if this is the only profile
        count = await self._count_user_profiles(user_id)
        if count <= 1:
            raise ValidationError("Cannot delete the only profile. Create another profile first.")

        await self.session.delete(profile)
        await self.session.commit()

        from uniffy.domains.notifications.cache import invalidate_cached_settings

        await invalidate_cached_settings(user_id)

        return True

    async def list_profiles(
        self,
        user_id: UUID,
    ) -> list[SettingsProfile]:
        """
        List all profiles for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID.

        Returns
        -------
        list[SettingsProfile]
            List of profiles for the user.

        """
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
        """
        Get the default profile for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID.

        Returns
        -------
        SettingsProfile | None
            The default profile, or None if no default is set.

        """
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
        """
        Get or create a default profile for a user.

        If no default profile exists, creates one named "Default".
        If no profiles exist at all, creates a default profile.

        Parameters
        ----------
        user_id : UUID
            The user ID.

        Returns
        -------
        SettingsProfile
            The default profile.

        """
        # Try to get existing default
        profile = await self.get_default_profile(user_id)
        if profile:
            return profile

        # If no default, try to get any profile and make it default
        profiles = await self.list_profiles(user_id)
        if profiles:
            profiles[0].is_default = True
            await self.session.commit()
            await self.session.refresh(profiles[0])
            return profiles[0]

        # No profiles at all, create a default one.
        # Handle race condition: concurrent requests may both try to create
        # the default profile simultaneously. If we lose the race, rollback
        # and return the profile that the other request created.
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
        """
        Set a profile as the default for a user.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        profile_id : UUID
            The profile ID to set as default.

        Returns
        -------
        SettingsProfile
            The updated profile.

        """
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
        """
        Compute effective settings by merging profile overrides with defaults.

        Parameters
        ----------
        profile : SettingsProfile
            The profile with user overrides.

        Returns
        -------
        dict
            Effective settings with all defaults filled in.

        """
        return {
            "appearance": get_effective_appearance(profile.appearance),
            "keyboard_shortcuts": get_effective_keyboard_shortcuts(profile.keyboard_shortcuts),
            "notifications": get_effective_notifications(profile.notifications),
        }

    def get_settings_schema(self) -> dict[str, Any]:
        """
        Get the schema of available settings with their defaults.

        Returns
        -------
        dict
            Settings schema with default values.

        """
        return {
            "appearance_defaults": get_appearance_defaults_dict(),
            "keyboard_shortcuts_defaults": get_keyboard_shortcuts_defaults_dict(),
            "notifications_defaults": get_notifications_defaults_dict(),
        }

    # ─────────────────────────────────────────────────────────────
    # Private helper methods
    # ─────────────────────────────────────────────────────────────

    async def _get_profile_by_name(
        self,
        user_id: UUID,
        name: str,
    ) -> SettingsProfile | None:
        """Get a profile by name for a user."""
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
        """Unset is_default on all profiles for a user."""
        await self.session.execute(
            update(SettingsProfile)
            .where(SettingsProfile.user_id == user_id)
            .values(is_default=False)
        )

    async def _count_user_profiles(self, user_id: UUID) -> int:
        """Count profiles for a user."""
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
        """
        Merge update values into existing settings (sparse update).

        None values in updates are used to reset to defaults (remove override).
        """
        if existing is None:
            existing = {}

        result = existing.copy()

        for key, value in updates.items():
            if value is None:
                # Remove override to reset to default
                result.pop(key, None)
            elif isinstance(value, dict) and isinstance(result.get(key), dict):
                # Deep merge for nested dicts (like bindings)
                result[key] = {**result[key], **value}
            else:
                result[key] = value

        return result if result else None
