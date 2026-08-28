"""Per-org default access-policy resolution.

A NULL ``access_mode`` on a content row inherits from
``permissions_org_defaults``; non-NULL is an explicit override. Fallback
chain: org-default row -> ``ORG_PERMISSION_DEFAULTS`` -> ``(OWNER_ONLY, None)``.
"""

from typing import TypedDict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType


class PermissionDefaults(TypedDict):
    default_access_mode: AccessMode
    default_baseline_role: ContentRole | None


ORG_PERMISSION_DEFAULTS: dict[ContentType, PermissionDefaults] = {
    ContentType.NOTE: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.EDITOR,
    },
    ContentType.FILE: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.PROJECT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.EDITOR,
    },
    ContentType.AGENT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.ROOM: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.AGENT_CRON_TASK: {
        "default_access_mode": AccessMode.OWNER_ONLY,
        "default_baseline_role": None,
    },
}


async def resolve_content_defaults(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
) -> tuple[AccessMode, ContentRole | None]:
    """Resolve the ``(access_mode, baseline_role)`` defaults for a content type."""
    row = (
        await session.execute(
            select(
                OrganizationPermissionDefaults.default_access_mode,
                OrganizationPermissionDefaults.default_baseline_role,
            ).where(
                OrganizationPermissionDefaults.organization_id == organization_id,
                OrganizationPermissionDefaults.content_type == content_type,
            )
        )
    ).first()

    if row is not None:
        return row[0], row[1]

    fallback = ORG_PERMISSION_DEFAULTS.get(content_type)
    if fallback is not None:
        return fallback["default_access_mode"], fallback["default_baseline_role"]

    return AccessMode.OWNER_ONLY, None


async def resolve_access_policy(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    access_mode: AccessMode | None,
    baseline_role: ContentRole | None,
) -> tuple[AccessMode | None, ContentRole | None]:
    """Validate an ``(access_mode, baseline_role)`` pair for storage.

    Rules:
    - ``(None, None)`` inherits org defaults at read time.
    - ``(None, X)`` is rejected - a baseline without an explicit mode is undefined.
    - With ``OPEN_TO_ORG``, ``baseline_role`` may be NULL (inherits) or any role
      except ``OWNER`` / ``BLOCKED``.
    - With any other explicit mode, ``baseline_role`` is forced to NULL.
    """
    if access_mode is None:
        if baseline_role is not None:
            raise ValidationError(
                "baseline_role",
                "baseline_role cannot be set without an access_mode",
            )
        return None, None

    if access_mode == AccessMode.OPEN_TO_ORG:
        if baseline_role in (ContentRole.OWNER, ContentRole.BLOCKED):
            raise ValidationError(
                "baseline_role",
                f"{baseline_role.value} is not a valid baseline role",
            )
        return access_mode, baseline_role

    return access_mode, None


_MODE_OPENNESS: dict[AccessMode, int] = {
    AccessMode.OWNER_ONLY: 0,
    AccessMode.EXPLICIT_MEMBERS: 1,
    AccessMode.OPEN_TO_ORG: 2,
}


def modes_at_least_as_open(mode: AccessMode) -> list[AccessMode]:
    """Access modes no narrower than ``mode``.

    Used by denormalized child aggregates: one number reaches everyone who can
    resolve the parent, so children with a narrower mode must stay uncounted.
    """
    return [m for m, rank in _MODE_OPENNESS.items() if rank >= _MODE_OPENNESS[mode]]


def resolve_effective_policy(
    raw_access_mode: AccessMode | None,
    raw_baseline_role: ContentRole | None,
    org_default_access_mode: AccessMode | None,
    org_default_baseline_role: ContentRole | None,
) -> tuple[AccessMode, ContentRole | None]:
    """Materialise the live ``(access_mode, baseline_role)`` for a content row.

    Resolution:
    - raw mode NULL -> org default mode (baseline ignored per storage invariant);
      ``OWNER_ONLY`` floor when the org has no default.
    - raw mode non-NULL and not ``OPEN_TO_ORG`` -> row mode, baseline forced NULL.
    - ``OPEN_TO_ORG`` + raw baseline NULL -> baseline inherits org default
      (``VIEWER`` safe floor).
    - ``OPEN_TO_ORG`` + raw baseline non-NULL -> row values verbatim.
    """
    if raw_access_mode is None:
        mode = org_default_access_mode or AccessMode.OWNER_ONLY
        baseline = org_default_baseline_role if mode == AccessMode.OPEN_TO_ORG else None
        return mode, baseline

    if raw_access_mode != AccessMode.OPEN_TO_ORG:
        return raw_access_mode, None

    if raw_baseline_role is None:
        baseline = org_default_baseline_role or ContentRole.VIEWER
        return raw_access_mode, baseline

    return raw_access_mode, raw_baseline_role


def resolve_effective_content_role(
    *,
    user_id: UUID,
    owner_id: UUID,
    is_active_member: bool,
    support_role: ContentRole | None,
    blocked: bool,
    granted_role: ContentRole | None,
    raw_access_mode: AccessMode | None,
    raw_baseline_role: ContentRole | None,
    org_default_access_mode: AccessMode | None,
    org_default_baseline_role: ContentRole | None,
) -> ContentRole | None:
    if support_role is not None:
        return support_role
    if not is_active_member or blocked:
        return None
    if owner_id == user_id:
        return ContentRole.OWNER
    if granted_role is not None:
        return granted_role
    mode, baseline = resolve_effective_policy(
        raw_access_mode,
        raw_baseline_role,
        org_default_access_mode,
        org_default_baseline_role,
    )
    return baseline if mode == AccessMode.OPEN_TO_ORG else None
