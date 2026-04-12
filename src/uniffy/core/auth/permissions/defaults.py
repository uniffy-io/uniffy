"""Helpers for resolving the per-org default access policy for new content.

When a user creates a piece of content (note, project, file, etc.) the
backend reads the organization's defaults for that content type and
applies them to the new row's ``access_mode`` and ``baseline_role``
columns. The helpers here are the single point of resolution; every
domain calls them instead of inlining the lookup.

The fallback chain is:

1. ``permissions_org_defaults`` row for ``(organization_id, content_type)``
2. The static ``ORG_PERMISSION_DEFAULTS`` dict shipped in
   :mod:`uniffy.domains.organizations.defaults`
3. ``(OWNER_ONLY, None)`` as the safe last resort if both are absent
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType


async def resolve_content_defaults(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
) -> tuple[AccessMode, ContentRole | None]:
    """Resolve the (access_mode, baseline_role) defaults for a content type.

    Reads the organization's row from ``permissions_org_defaults`` if one
    exists. Otherwise falls back to the static ``ORG_PERMISSION_DEFAULTS``
    dict (lazy-imported to avoid pulling in the organizations domain at
    import time). If the static dict has no entry, returns
    ``(OWNER_ONLY, None)``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    organization_id : UUID
        Organization scope.
    content_type : ContentType
        Type of content the new row will have.

    Returns
    -------
    tuple[AccessMode, ContentRole | None]
        ``(access_mode, baseline_role)`` to use on the new content row.
        ``baseline_role`` is non-null iff ``access_mode == OPEN_TO_ORG``.

    """
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
