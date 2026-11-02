"""Per-user, per-organization dashboard layouts kept on the default settings profile."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.errors import ConflictError, MembershipRequiredError, NotFoundError
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.settings.dashboard.definition import (
    Definition,
    load_catalog,
    parse_stored,
    validate_for_save,
)
from uniffy.domains.settings.operations import SettingsOperations

_REVISION = "revision"
_DEFINITION = "definition"
_PREVIOUS = "previous"


@dataclass(frozen=True)
class StoredDashboard:
    definition: Definition | None
    revision: int
    has_previous: bool


def _entry(profile: SettingsProfile, organization_id: UUID) -> dict[str, Any]:
    entry = (profile.dashboards or {}).get(str(organization_id))
    return entry if isinstance(entry, dict) else {}


def _stored(entry: dict[str, Any]) -> StoredDashboard:
    catalog = load_catalog()
    revision = entry.get(_REVISION)
    return StoredDashboard(
        definition=parse_stored(entry.get(_DEFINITION), catalog),
        revision=revision if isinstance(revision, int) else 0,
        has_previous=isinstance(entry.get(_PREVIOUS), dict),
    )


class DashboardOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _require_member(self, user_id: UUID, organization_id: UUID) -> None:
        if not await get_active_membership(self.session, user_id, organization_id):
            raise MembershipRequiredError("Requires organization membership")

    async def _locked_profile(self, user_id: UUID) -> SettingsProfile:
        profile = await SettingsOperations(self.session).get_or_create_default_profile(user_id)
        locked = (
            await self.session.execute(
                select(SettingsProfile).where(SettingsProfile.id == profile.id).with_for_update()
            )
        ).scalar_one_or_none()
        if locked is None:
            raise NotFoundError("settings_profile", profile.id)
        return locked

    async def get(self, user_id: UUID, organization_id: UUID) -> StoredDashboard:
        await self._require_member(user_id, organization_id)
        profile = await SettingsOperations(self.session).get_default_profile(user_id)
        return _stored(_entry(profile, organization_id) if profile else {})

    async def _write(
        self,
        profile: SettingsProfile,
        organization_id: UUID,
        expected_revision: int,
        entry: dict[str, Any],
    ) -> StoredDashboard:
        current = _entry(profile, organization_id)
        revision = current.get(_REVISION, 0)
        if revision != expected_revision:
            raise ConflictError(
                "dashboard", "The dashboard changed since it was loaded; reload and try again"
            )
        entry[_REVISION] = revision + 1
        # A fresh dict, so the JSONB column registers as changed.
        profile.dashboards = {**(profile.dashboards or {}), str(organization_id): entry}
        profile.updated_at = datetime.now(UTC)
        await self.session.commit()
        return _stored(entry)

    async def save(
        self,
        user_id: UUID,
        organization_id: UUID,
        definition: Definition,
        expected_revision: int,
        *,
        keep_previous: bool,
    ) -> StoredDashboard:
        await self._require_member(user_id, organization_id)
        checked = validate_for_save(definition, load_catalog())
        profile = await self._locked_profile(user_id)
        current = _entry(profile, organization_id)
        entry: dict[str, Any] = {_DEFINITION: checked.to_json()}
        if keep_previous:
            # The replaced layout is what Restore brings back, or the default when there was none.
            entry[_PREVIOUS] = current.get(_DEFINITION) or load_catalog().default.to_json()
        elif isinstance(current.get(_PREVIOUS), dict):
            # Renames and hand edits keep the way back to the layout a template replaced.
            entry[_PREVIOUS] = current[_PREVIOUS]
        return await self._write(profile, organization_id, expected_revision, entry)

    async def restore_previous(
        self, user_id: UUID, organization_id: UUID, expected_revision: int
    ) -> StoredDashboard:
        await self._require_member(user_id, organization_id)
        profile = await self._locked_profile(user_id)
        previous = _entry(profile, organization_id).get(_PREVIOUS)
        if not isinstance(previous, dict):
            raise NotFoundError("dashboard_previous", organization_id)
        return await self._write(
            profile, organization_id, expected_revision, {_DEFINITION: previous}
        )
