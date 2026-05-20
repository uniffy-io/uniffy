"""Per-org default access policy resolution.

A NULL ``access_mode`` on a content row inherits live from
``permissions_org_defaults``; non-NULL is an explicit override.
:func:`resolve_effective_policy` materialises the effective pair on
every access check. Fallback chain: org-default row →
``ORG_PERMISSION_DEFAULTS`` static dict → ``(OWNER_ONLY, None)``.
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

    Reads the org's ``permissions_org_defaults`` row; falls back to the
    static ``ORG_PERMISSION_DEFAULTS`` dict, then ``(OWNER_ONLY, None)``.

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
) -> tuple[AccessMode | None, ContentRole | None]:
    """Validate an ``(access_mode, baseline_role)`` pair for storage.

    Does **not** consult org defaults. The runtime is responsible for
    materialising the effective policy on read via
    :func:`resolve_effective_policy`. This helper only validates the
    pair the caller intends to store.

    Rules:

    - ``(None, None)`` is valid - the row will inherit org defaults at
      read time.
    - ``(None, X)`` is rejected - a non-NULL baseline without an explicit
      mode has no defined semantics. Callers wanting an inherited mode
      must pass ``baseline=None`` too.
    - With ``access_mode == OPEN_TO_ORG``, ``baseline_role`` may be NULL
      (inherits org default baseline) or any role except ``OWNER`` /
      ``BLOCKED``.
    - With any other explicit ``access_mode``, ``baseline_role`` is
      forced to NULL.

    Raises
    ------
    ValidationError
        If ``baseline_role`` is ``OWNER`` / ``BLOCKED`` on ``OPEN_TO_ORG``,
        or if a baseline is supplied without an access mode.
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
    """Materialise the live policy for a content row.

    Given the row's raw ``(access_mode, baseline_role)`` columns and the
    org's defaults for the content type, return the ``(effective_mode,
    effective_baseline)`` pair the permission machinery should consult.

    Resolution:

    - ``raw_access_mode`` is NULL → use ``org_default_access_mode``.
      ``raw_baseline_role`` is ignored (cannot be non-NULL when the mode
      is NULL by the storage invariant in :func:`resolve_access_policy`).
      Falls back to ``OWNER_ONLY`` if the org has no default.
    - ``raw_access_mode`` is non-NULL and not ``OPEN_TO_ORG`` → use the
      row's mode, force baseline to NULL.
    - ``raw_access_mode == OPEN_TO_ORG`` and ``raw_baseline_role`` is NULL
      → use the row's mode, baseline inherits from
      ``org_default_baseline_role`` (or ``VIEWER`` as the safe floor).
    - ``raw_access_mode == OPEN_TO_ORG`` and ``raw_baseline_role`` is
      non-NULL → use the row's values verbatim.

    Pure function; no DB access. The caller is responsible for caching
    the org-defaults lookup if it's hot.
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
