"""Support-session policy resolver; per-org override can only TIGHTEN the
deployment default, never loosen.
"""

from __future__ import annotations

import os
from enum import Enum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.org_setting import OrgSetting

_SUPPORT_NAMESPACE = "support"
_REQUIRED_CONSENT_KEY = "required_consent"

DEFAULT_DURATION_FLOOR_MINUTES = 5


class ConsentMode(str, Enum):
    OWNER_APPROVED = "OWNER_APPROVED"
    OPERATOR_JUSTIFIED = "OPERATOR_JUSTIFIED"


def deployment_consent_mode() -> ConsentMode:
    raw = os.getenv("SUPPORT_SESSION_MODE", "").strip().upper()
    if raw == ConsentMode.OPERATOR_JUSTIFIED.value:
        return ConsentMode.OPERATOR_JUSTIFIED
    return ConsentMode.OWNER_APPROVED


def deployment_default_duration_minutes() -> int:
    try:
        value = int(os.getenv("DEFAULT_SUPPORT_SESSION_DURATION_MINUTES", "30"))
    except ValueError:
        return 30
    return max(DEFAULT_DURATION_FLOOR_MINUTES, value)


def deployment_max_duration_minutes() -> int:
    try:
        value = int(os.getenv("MAX_SUPPORT_SESSION_DURATION_MINUTES", "120"))
    except ValueError:
        return 120
    return max(DEFAULT_DURATION_FLOOR_MINUTES, value)


def clamp_duration(requested_minutes: int) -> int:
    """Zero or negative falls back to the deployment default; positive
    requests clamp into ``[floor, deployment_max]``.
    """
    if requested_minutes <= 0:
        return deployment_default_duration_minutes()
    ceiling = deployment_max_duration_minutes()
    floor = DEFAULT_DURATION_FLOOR_MINUTES
    return max(floor, min(requested_minutes, ceiling))


async def org_override(session: AsyncSession, organization_id: UUID) -> ConsentMode | None:
    row = (
        await session.execute(
            select(OrgSetting).where(
                OrgSetting.organization_id == organization_id,
                OrgSetting.namespace == _SUPPORT_NAMESPACE,
                OrgSetting.key == _REQUIRED_CONSENT_KEY,
            )
        )
    ).scalar_one_or_none()
    if row is None or row.is_secret or row.value is None:
        return None
    raw = str(row.value).strip().upper()
    if raw == ConsentMode.OWNER_APPROVED.value:
        return ConsentMode.OWNER_APPROVED
    if raw == ConsentMode.OPERATOR_JUSTIFIED.value:
        return ConsentMode.OPERATOR_JUSTIFIED
    return None


async def effective_consent_mode(session: AsyncSession, organization_id: UUID) -> ConsentMode:
    """Org override can tighten but never loosen the deployment default."""
    deployment = deployment_consent_mode()
    override = await org_override(session, organization_id)
    if deployment == ConsentMode.OWNER_APPROVED:
        return ConsentMode.OWNER_APPROVED
    if override == ConsentMode.OWNER_APPROVED:
        return ConsentMode.OWNER_APPROVED
    return ConsentMode.OPERATOR_JUSTIFIED


async def set_org_override(
    session: AsyncSession,
    *,
    organization_id: UUID,
    mode: ConsentMode | None,
    updated_by_user_id: UUID,
) -> ConsentMode | None:
    """``mode=None`` clears the override; tighten-only enforcement lives in
    ``effective_consent_mode``.
    """
    from uniffy.domains.org_settings.operations import OrgSettingsOperations

    ops = OrgSettingsOperations(session)
    if mode is None:
        await ops.delete_key(
            organization_id=organization_id,
            namespace=_SUPPORT_NAMESPACE,
            key=_REQUIRED_CONSENT_KEY,
        )
        return None
    await ops.set(
        organization_id=organization_id,
        namespace=_SUPPORT_NAMESPACE,
        key=_REQUIRED_CONSENT_KEY,
        value=mode.value,
        is_secret=False,
        updated_by_user_id=updated_by_user_id,
    )
    return mode


__all__ = [
    "ConsentMode",
    "DEFAULT_DURATION_FLOOR_MINUTES",
    "clamp_duration",
    "deployment_consent_mode",
    "deployment_default_duration_minutes",
    "deployment_max_duration_minutes",
    "effective_consent_mode",
    "org_override",
    "set_org_override",
]
