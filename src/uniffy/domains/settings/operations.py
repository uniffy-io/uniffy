"""Settings profile CRUD + effective-settings computation."""

import re
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.types import NotificationType
from uniffy.domains.notifications.cache import invalidate_cached_settings
from uniffy.domains.settings.defaults import (
    DEFAULT_REMINDER_INTERVALS,
    SCHEDULING_DEFAULTS,
    WORKDAY_NAMES,
    EmailFrequency,
    get_appearance_defaults_dict,
    get_effective_appearance,
    get_effective_keyboard_shortcuts,
    get_effective_notifications,
    get_effective_scheduling,
    get_keyboard_shortcuts_defaults_dict,
    get_notifications_defaults_dict,
    get_scheduling_defaults_dict,
)

_WEEK_START_VALUES = {"monday", "saturday", "sunday"}
_MAX_REMINDER_MINUTES = 4 * 7 * 24 * 60
_CLOCK_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_NOTIFICATION_CHANNELS = {"in_app", "browser", "email"}


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


def _validate_notifications(notifications: dict[str, Any] | None) -> None:
    if not notifications:
        return
    start = notifications.get("quiet_hours_start") or None
    end = notifications.get("quiet_hours_end") or None
    if (start is None) != (end is None):
        raise ValidationError(
            "quiet_hours",
            "Quiet hours require both a start and an end time",
        )
    if start is not None:
        if not isinstance(start, str) or not _CLOCK_RE.fullmatch(start):
            raise ValidationError("quiet_hours_start", "Quiet-hours start must use HH:MM")
        if not isinstance(end, str) or not _CLOCK_RE.fullmatch(end):
            raise ValidationError("quiet_hours_end", "Quiet-hours end must use HH:MM")
        if start == end:
            raise ValidationError("quiet_hours", "Quiet-hours start and end must differ")

    frequency = notifications.get("email_frequency")
    if frequency is not None and frequency not in {item.value for item in EmailFrequency}:
        raise ValidationError("email_frequency", f"Unknown email frequency '{frequency}'")

    digest_time = notifications.get("email_digest_time")
    if digest_time is not None and (
        not isinstance(digest_time, str) or not _CLOCK_RE.fullmatch(digest_time)
    ):
        raise ValidationError("email_digest_time", "Daily digest time must use HH:MM")

    intervals = notifications.get("default_reminder_intervals")
    if intervals is not None and (
        not isinstance(intervals, list)
        or not all(
            isinstance(minutes, int)
            and not isinstance(minutes, bool)
            and 0 <= minutes <= _MAX_REMINDER_MINUTES
            for minutes in intervals
        )
    ):
        raise ValidationError(
            "default_reminder_intervals",
            "Reminder intervals must be whole minutes between 0 and four weeks",
        )

    channel_overrides = notifications.get("channel_overrides")
    if channel_overrides is None:
        return
    if not isinstance(channel_overrides, dict):
        raise ValidationError("channel_overrides", "Notification channel overrides must be a map")
    known_types = {item.value for item in NotificationType}
    for notification_type, channels in channel_overrides.items():
        if notification_type not in known_types:
            raise ValidationError(
                "channel_overrides",
                f"Unknown notification type '{notification_type}'",
            )
        if not isinstance(channels, dict):
            raise ValidationError(
                "channel_overrides",
                f"Channels for '{notification_type}' must be a map",
            )
        for channel, enabled in channels.items():
            if channel not in _NOTIFICATION_CHANNELS or not isinstance(enabled, bool):
                raise ValidationError(
                    "channel_overrides",
                    f"Invalid channel preference '{channel}' for '{notification_type}'",
                )


def _validate_scheduling(scheduling: dict[str, Any] | None) -> None:
    if not scheduling:
        return
    start = scheduling.get("workday_start")
    end = scheduling.get("workday_end")
    for key, value in (("workday_start", start), ("workday_end", end)):
        if value is not None and (not isinstance(value, str) or not _CLOCK_RE.fullmatch(value)):
            raise ValidationError(key, "Workday times must use HH:MM")
    if start is not None and end is not None and start >= end:
        raise ValidationError("workday_end", "Workday end must be after its start")
    workdays = scheduling.get("workdays")
    if workdays is not None:
        if not isinstance(workdays, list) or not workdays:
            raise ValidationError("workdays", "Workdays must be a non-empty list of day names")
        unknown = [day for day in workdays if day not in WORKDAY_NAMES]
        if unknown:
            raise ValidationError("workdays", f"Unknown workdays: {', '.join(unknown)}")


@dataclass(frozen=True)
class SchedulingContext:
    """Resolved per-user scheduling facts for availability computation."""

    timezone: str
    workday_start: str
    workday_end: str
    workdays: tuple[str, ...]


async def get_users_scheduling_context(
    session: AsyncSession,
    user_ids: Collection[UUID],
) -> dict[UUID, SchedulingContext]:
    """Batched: every requested id resolves, defaults filling any gap.

    Timezone chain: private appearance preference -> org-visible people
    profile -> UTC. One query per table regardless of how many users.
    """
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    profile_rows = (
        await session.execute(
            select(
                SettingsProfile.user_id,
                SettingsProfile.appearance,
                SettingsProfile.scheduling,
            ).where(
                SettingsProfile.user_id.in_(ids),
                SettingsProfile.is_default == True,  # noqa: E712
            )
        )
    ).all()
    people_rows = (
        await session.execute(
            select(PeopleProfile.user_id, PeopleProfile.timezone).where(
                PeopleProfile.user_id.in_(ids),
                PeopleProfile.timezone.is_not(None),
            )
        )
    ).all()
    appearance_by_user = {row.user_id: row.appearance or {} for row in profile_rows}
    scheduling_by_user = {row.user_id: row.scheduling or {} for row in profile_rows}
    people_tz = {row.user_id: row.timezone for row in people_rows}

    contexts: dict[UUID, SchedulingContext] = {}
    for uid in ids:
        scheduling = scheduling_by_user.get(uid, {})
        workdays = scheduling.get("workdays") or SCHEDULING_DEFAULTS.workdays
        contexts[uid] = SchedulingContext(
            timezone=(
                appearance_by_user.get(uid, {}).get("timezone") or people_tz.get(uid) or "UTC"
            ),
            workday_start=scheduling.get("workday_start") or SCHEDULING_DEFAULTS.workday_start,
            workday_end=scheduling.get("workday_end") or SCHEDULING_DEFAULTS.workday_end,
            workdays=tuple(workdays),
        )
    return contexts


async def get_user_timezone(session: AsyncSession, user_id: UUID) -> str | None:
    """Stored display timezone from the user's default profile; None = automatic."""
    profile = await SettingsOperations(session).get_default_profile(user_id)
    if not profile or not profile.appearance:
        return None
    return profile.appearance.get("timezone") or None


async def get_user_reminder_defaults(session: AsyncSession, user_id: UUID) -> list[int]:
    """The member's configured default reminder intervals in minutes.

    An explicitly configured empty list means "no reminders" and is honored;
    only an unset preference falls back to the global default.
    """
    profile = await SettingsOperations(session).get_default_profile(user_id)
    configured = (profile.notifications or {}).get("default_reminder_intervals") if profile else None
    if configured is None:
        return list(DEFAULT_REMINDER_INTERVALS)
    return [int(minutes) for minutes in configured]


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
        scheduling: dict[str, Any] | None = None,
        is_default: bool = False,
    ) -> SettingsProfile:
        existing = await self._get_profile_by_name(user_id, name)
        if existing:
            raise ValidationError("name", f"Profile with name '{name}' already exists")

        _validate_appearance(appearance)
        _validate_notifications(notifications)
        _validate_scheduling(scheduling)

        if is_default:
            await self._unset_default_profiles(user_id)

        profile = SettingsProfile(
            user_id=user_id,
            name=name,
            appearance=appearance,
            keyboard_shortcuts=keyboard_shortcuts,
            notifications=notifications,
            scheduling=scheduling,
            is_default=is_default,
        )

        self.session.add(profile)
        await self.session.commit()
        await self.session.refresh(profile)

        if is_default:
            await invalidate_cached_settings(user_id)

        return profile

    async def get_profile(
        self,
        user_id: UUID,
        profile_id: UUID,
    ) -> SettingsProfile:
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
        scheduling: dict[str, Any] | None = None,
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
            merged_notifications = self._merge_settings(profile.notifications, notifications)
            _validate_notifications(merged_notifications)
            profile.notifications = merged_notifications

        if scheduling is not None:
            merged_scheduling = self._merge_settings(profile.scheduling, scheduling)
            _validate_scheduling(merged_scheduling)
            profile.scheduling = merged_scheduling

        if is_default is not None:
            if is_default and not profile.is_default:
                await self._unset_default_profiles(user_id)
            profile.is_default = is_default

        profile.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(profile)

        if notifications is not None or is_default:
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
            await invalidate_cached_settings(user_id)
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
            await invalidate_cached_settings(user_id)

        return profile

    def get_effective_settings(
        self,
        profile: SettingsProfile,
    ) -> dict[str, Any]:
        return {
            "appearance": get_effective_appearance(profile.appearance),
            "keyboard_shortcuts": get_effective_keyboard_shortcuts(profile.keyboard_shortcuts),
            "notifications": get_effective_notifications(profile.notifications),
            "scheduling": get_effective_scheduling(profile.scheduling),
        }

    def get_settings_schema(self) -> dict[str, Any]:
        return {
            "appearance_defaults": get_appearance_defaults_dict(),
            "keyboard_shortcuts_defaults": get_keyboard_shortcuts_defaults_dict(),
            "notifications_defaults": get_notifications_defaults_dict(),
            "scheduling_defaults": get_scheduling_defaults_dict(),
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
