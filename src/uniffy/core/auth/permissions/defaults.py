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


async def resolve_access_policy(
    session: AsyncSession,
    organization_id: UUID,
    content_type: ContentType,
    access_mode: AccessMode | None,
    baseline_role: ContentRole | None,
) -> tuple[AccessMode, ContentRole | None]:
    """Fill in defaults and validate an ``(access_mode, baseline_role)`` pair.

    Every domain ``create()`` path calls this helper to turn optional
    caller args into the canonical tuple stored on the content row.

    Resolution rules:

    - If ``access_mode`` is ``None``, load org defaults for ``content_type``.
      ``baseline_role`` stays ``None`` unless also unset, in which case the
      org default baseline fills it.
    - If ``access_mode`` is ``OPEN_TO_ORG`` and ``baseline_role`` is
      ``None`` (caller supplied the mode explicitly but no baseline),
      fall back to the org default baseline. If that is also ``None``,
      fall back to ``ContentRole.VIEWER`` as the safe least-privilege
      baseline so callers (e.g. UI dropping content into the org tree)
      do not need to know the org-configured default.
    - If the resolved ``access_mode`` is ``OPEN_TO_ORG``, ``baseline_role``
      must not be ``OWNER`` or ``BLOCKED``.
    - For any other ``access_mode``, ``baseline_role`` is forced to ``None``.

    Raises
    ------
    ValidationError
        If ``baseline_role`` is ``OWNER`` / ``BLOCKED`` on ``OPEN_TO_ORG``.
    """
    if access_mode is None:
        access_mode, default_baseline = await resolve_content_defaults(
            session, organization_id, content_type
        )
        if baseline_role is None:
            baseline_role = default_baseline

    if access_mode == AccessMode.OPEN_TO_ORG:
        if baseline_role is None:
            _, default_baseline = await resolve_content_defaults(
                session, organization_id, content_type
            )
            baseline_role = default_baseline or ContentRole.VIEWER

        if baseline_role in (ContentRole.OWNER, ContentRole.BLOCKED):
            raise ValidationError(
                "baseline_role",
                f"{baseline_role.value} is not a valid baseline role",
            )
        return access_mode, baseline_role

    return access_mode, None
