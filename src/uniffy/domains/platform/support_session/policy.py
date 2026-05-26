"""Effective support-session policy resolver.

Layered configuration:

1. **Deployment default** -- ``SUPPORT_SESSION_MODE`` env var, one of
   ``OWNER_APPROVED`` (privacy-safe; cloud default) or
   ``OPERATOR_JUSTIFIED`` (sessions go ACTIVE immediately; appropriate
   for self-hosted single-tenant where the operator IS the owner).
   Unset defaults to ``OWNER_APPROVED``.
2. **Per-org override** -- ``org_settings(namespace='support',
   key='required_consent')`` row. Can only TIGHTEN the deployment
   default (``OPERATOR_JUSTIFIED -> OWNER_APPROVED``), never loosen
   (``OWNER_APPROVED -> OPERATOR_JUSTIFIED`` is silently ignored).

Duration is similarly layered:

* ``DEFAULT_SUPPORT_SESSION_DURATION_MINUTES`` env (default 30) sets
  the suggested-on-the-UI default.
* ``MAX_SUPPORT_SESSION_DURATION_MINUTES`` env (default 120) is the
  hard ceiling enforced server-side. Requests above the ceiling are
  clamped down.
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
    """How a support session goes ACTIVE."""

    OWNER_APPROVED = "OWNER_APPROVED"
    OPERATOR_JUSTIFIED = "OPERATOR_JUSTIFIED"


def deployment_consent_mode() -> ConsentMode:
    """Read the deployment default. Defaults to ``OWNER_APPROVED``."""
    raw = os.getenv("SUPPORT_SESSION_MODE", "").strip().upper()
    if raw == ConsentMode.OPERATOR_JUSTIFIED.value:
        return ConsentMode.OPERATOR_JUSTIFIED
    return ConsentMode.OWNER_APPROVED


def deployment_default_duration_minutes() -> int:
    """Default duration suggested on the request UI."""
    try:
        value = int(os.getenv("DEFAULT_SUPPORT_SESSION_DURATION_MINUTES", "30"))
    except ValueError:
        return 30
    return max(DEFAULT_DURATION_FLOOR_MINUTES, value)


def deployment_max_duration_minutes() -> int:
    """Hard ceiling on requested duration. Server clamps anything above this."""
    try:
        value = int(os.getenv("MAX_SUPPORT_SESSION_DURATION_MINUTES", "120"))
    except ValueError:
        return 120
    return max(DEFAULT_DURATION_FLOOR_MINUTES, value)


def clamp_duration(requested_minutes: int) -> int:
    """Clamp a requested duration into ``[floor, deployment_max]``.

    Zero or negative requests fall back to the deployment default.
    A positive request below the floor clamps UP to the floor; a
    request above the ceiling clamps DOWN to the ceiling. This keeps
    the operator's intent visible (a 1-minute request becomes a
    5-minute floor, not a silent jump to the 30-minute default).
    """
    if requested_minutes <= 0:
        return deployment_default_duration_minutes()
    ceiling = deployment_max_duration_minutes()
    floor = DEFAULT_DURATION_FLOOR_MINUTES
    return max(floor, min(requested_minutes, ceiling))


async def org_override(
    session: AsyncSession, organization_id: UUID
) -> ConsentMode | None:
    """Return the per-org override if one is set, else ``None``."""
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


async def effective_consent_mode(
    session: AsyncSession, organization_id: UUID
) -> ConsentMode:
    """Resolve the effective consent mode for one org.

    Org override may TIGHTEN the deployment default but never loosen
    it: if the deployment is OWNER_APPROVED, the org is OWNER_APPROVED
    regardless of any per-org row.
    """
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
    """Upsert the per-org override.

    ``mode=None`` clears the override (fall back to deployment).
    Tighten-only is enforced at the resolver layer, not here -- the
    raw override row can carry any value; ``effective_consent_mode``
    overrides it back to OWNER_APPROVED when the deployment requires.
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
