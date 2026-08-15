"""Operator-editable deployment flags; resolution chain is DB row > env default > coded default."""

from __future__ import annotations

import os
from typing import NamedTuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.deployment_settings.operations import DeploymentSettingsOperations
from uniffy.domains.users.operations import UserOperations

_NAMESPACE = "system"
_KEY_PUBLIC_REGISTRATION = "public_registration"
_ENV_PUBLIC_REGISTRATION = "ALLOW_PUBLIC_REGISTRATION"


class SystemFlagState(NamedTuple):
    enabled: bool
    source: str  # 'deployment' | 'env' | 'default'


def _parse_bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _env_public_registration() -> bool | None:
    raw = os.getenv(_ENV_PUBLIC_REGISTRATION)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in ("1", "true", "yes")


async def _resolve_public_registration(session: AsyncSession) -> SystemFlagState:
    settings = DeploymentSettingsOperations(session)
    rows = await settings.get_namespace(_NAMESPACE)
    row = rows.get(_KEY_PUBLIC_REGISTRATION)
    if row is not None and not row.is_secret:
        return SystemFlagState(enabled=_parse_bool(row.value, default=False), source="deployment")
    env_value = _env_public_registration()
    if env_value is not None:
        return SystemFlagState(enabled=env_value, source="env")
    return SystemFlagState(enabled=False, source="default")


async def public_registration_enabled(session: AsyncSession) -> bool:
    """Gate predicate used by the auth ``Register`` flow."""
    state = await _resolve_public_registration(session)
    return state.enabled


class SystemConfigOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)
        self._settings = DeploymentSettingsOperations(session)

    async def get_state(self, *, user_id: UUID) -> dict[str, SystemFlagState]:
        await self._user_ops.require_system_admin(user_id)
        return {
            _KEY_PUBLIC_REGISTRATION: await _resolve_public_registration(self._session),
        }

    async def set_public_registration(
        self,
        *,
        user_id: UUID,
        enabled: bool,
    ) -> dict[str, SystemFlagState]:
        await self._user_ops.require_system_admin(user_id)
        previous = await _resolve_public_registration(self._session)
        await self._settings.set(
            namespace=_NAMESPACE,
            key=_KEY_PUBLIC_REGISTRATION,
            value=bool(enabled),
            is_secret=False,
            updated_by_user_id=user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.SYSTEM_PUBLIC_REGISTRATION_CHANGED,
            resource_type=AuditResourceType.SYSTEM_FLAG,
            resource_id=None,
            details={
                "key": _KEY_PUBLIC_REGISTRATION,
                "previous_enabled": previous.enabled,
                "previous_source": previous.source,
                "new_enabled": bool(enabled),
            },
        )
        await self._session.commit()
        return await self.get_state(user_id=user_id)
