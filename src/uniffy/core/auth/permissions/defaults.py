"""Per-org default access-policy resolution.

A NULL ``access_mode`` on a content row inherits from
``permissions_org_defaults``; non-NULL is an explicit override. Fallback
chain: org-default row -> ``ORG_PERMISSION_DEFAULTS`` -> ``(OWNER_ONLY, None)``.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType


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

    from uniffy.domains.organizations.defaults import ORG_PERMISSION_DEFAULTS

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
