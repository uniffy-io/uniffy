"""Resolve deployment-wide public registration policy."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings import DeploymentSettingsOperations

PUBLIC_REGISTRATION_NAMESPACE = "system"
PUBLIC_REGISTRATION_KEY = "public_registration"
_PUBLIC_REGISTRATION_ENV = "ALLOW_PUBLIC_REGISTRATION"


class RegistrationSource(StrEnum):
    DEPLOYMENT = "deployment"
    ENV = "env"
    DEFAULT = "default"


@dataclass(frozen=True, slots=True)
class PublicRegistrationState:
    enabled: bool
    source: RegistrationSource


def _parse_bool(value: object, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _env_public_registration() -> bool | None:
    raw = os.getenv(_PUBLIC_REGISTRATION_ENV)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in ("1", "true", "yes")


async def resolve_public_registration(session: AsyncSession) -> PublicRegistrationState:
    settings = DeploymentSettingsOperations(session)
    rows = await settings.get_namespace(PUBLIC_REGISTRATION_NAMESPACE)
    row = rows.get(PUBLIC_REGISTRATION_KEY)
    if row is not None and not row.is_secret:
        return PublicRegistrationState(
            enabled=_parse_bool(row.value, default=False),
            source=RegistrationSource.DEPLOYMENT,
        )

    env_value = _env_public_registration()
    if env_value is not None:
        return PublicRegistrationState(enabled=env_value, source=RegistrationSource.ENV)
    return PublicRegistrationState(enabled=False, source=RegistrationSource.DEFAULT)


async def public_registration_enabled(session: AsyncSession) -> bool:
    return (await resolve_public_registration(session)).enabled
