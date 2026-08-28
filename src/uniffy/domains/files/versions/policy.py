"""Per-org file version retention backed by the generic ``org_settings`` KV store.

One JSON blob under ``namespace='files'``, ``key='version_policy'``. Resolution:
per-org row -> ``FILE_VERSION_RETENTION`` env -> coded default.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.domain_admin import is_domain_admin
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.types import DomainType

logger = logger.bind(component="files.versions.policy")

FILES_NAMESPACE = "files"
VERSION_POLICY_KEY = "version_policy"

DEFAULT_KEEP_VERSIONS = 10
MIN_KEEP_VERSIONS = 1
MAX_KEEP_VERSIONS = 100


@dataclass(frozen=True)
class ResolvedFileVersionPolicy:
    """Effective per-org retention; ``keep_versions`` counts the current one."""

    organization_id: UUID
    keep_versions: int = DEFAULT_KEEP_VERSIONS


def clamp_keep_versions(value: int) -> int:
    return max(MIN_KEEP_VERSIONS, min(MAX_KEEP_VERSIONS, value))


def env_default_keep_versions() -> int:
    raw = os.getenv("FILE_VERSION_RETENTION", "").strip()
    if not raw:
        return DEFAULT_KEEP_VERSIONS
    try:
        return clamp_keep_versions(int(raw))
    except ValueError:
        logger.warning(f"Invalid FILE_VERSION_RETENTION value {raw!r}; using default")
        return DEFAULT_KEEP_VERSIONS


def select_versions_to_prune(
    versions: Sequence[FileVersion],
    keep_versions: int,
    current_version_id: UUID | None,
) -> list[FileVersion]:
    """Newest ``keep_versions`` survive; the current version always survives."""
    keep = max(MIN_KEEP_VERSIONS, keep_versions)
    ordered = sorted(versions, key=lambda v: v.version_number, reverse=True)
    return [v for v in ordered[keep:] if v.id != current_version_id]


async def load_version_policy(
    session: AsyncSession, organization_id: UUID
) -> ResolvedFileVersionPolicy | None:
    """The org's stored policy, or ``None`` when no row exists."""
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, FILES_NAMESPACE)
    row = rows.get(VERSION_POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return None
    raw = row.value.get("keep_versions", DEFAULT_KEEP_VERSIONS)
    try:
        keep = clamp_keep_versions(int(raw))
    except TypeError, ValueError:
        keep = DEFAULT_KEEP_VERSIONS
    return ResolvedFileVersionPolicy(organization_id=organization_id, keep_versions=keep)


async def resolve_version_policy(
    session: AsyncSession, organization_id: UUID
) -> ResolvedFileVersionPolicy:
    stored = await load_version_policy(session, organization_id)
    if stored is not None:
        return stored
    return ResolvedFileVersionPolicy(
        organization_id=organization_id, keep_versions=env_default_keep_versions()
    )


async def _require_files_admin(session: AsyncSession, user_id: UUID, organization_id: UUID) -> None:
    """Org admin or files domain admin; same gate as storage quotas."""
    if await PermissionChecker(session).is_org_admin(user_id, organization_id):
        return
    if await is_domain_admin(session, user_id, organization_id, DomainType.FILES):
        return
    raise PermissionDeniedError("manage", "file version retention")


async def get_org_version_policy_view(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> ResolvedFileVersionPolicy:
    """Effective policy for the admin surface (row -> env -> coded default)."""
    await _require_files_admin(session, user_id, organization_id)
    return await resolve_version_policy(session, organization_id)


async def update_org_version_policy(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    keep_versions: int,
) -> ResolvedFileVersionPolicy:
    await _require_files_admin(session, user_id, organization_id)
    if not MIN_KEEP_VERSIONS <= keep_versions <= MAX_KEEP_VERSIONS:
        raise ValidationError(
            "keep_versions",
            f"Must be between {MIN_KEEP_VERSIONS} and {MAX_KEEP_VERSIONS}",
        )
    policy = ResolvedFileVersionPolicy(organization_id=organization_id, keep_versions=keep_versions)
    await OrgSettingsOperations(session).set(
        organization_id=organization_id,
        namespace=FILES_NAMESPACE,
        key=VERSION_POLICY_KEY,
        value={"keep_versions": policy.keep_versions},
        updated_by_user_id=user_id,
    )
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.ORGANIZATION_SETTINGS_CHANGED,
        resource_type=AuditResourceType.ORGANIZATION,
        resource_id=organization_id,
        details={"setting": "file_version_retention", "keep_versions": keep_versions},
    )
    await session.commit()
    return policy
