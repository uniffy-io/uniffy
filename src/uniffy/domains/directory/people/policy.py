"""Per-org profile policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='people'``, ``key='profile_policy'``.
An absent row means every setting takes its built-in default.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings.organization import OrgSettingsOperations

PEOPLE_NAMESPACE = "people"
POLICY_KEY = "profile_policy"

DEFAULT_DIRECTORY_ENABLED = True
DEFAULT_ORG_CHART_ENABLED = True


@dataclass(frozen=True)
class ResolvedProfilePolicy:
    """Effective per-org profile policy; field names mirror the proto message."""

    organization_id: UUID
    directory_enabled: bool = DEFAULT_DIRECTORY_ENABLED
    org_chart_enabled: bool = DEFAULT_ORG_CHART_ENABLED


def _from_blob(organization_id: UUID, blob: dict) -> ResolvedProfilePolicy:
    return ResolvedProfilePolicy(
        organization_id=organization_id,
        directory_enabled=bool(blob.get("directory_enabled", DEFAULT_DIRECTORY_ENABLED)),
        org_chart_enabled=bool(blob.get("org_chart_enabled", DEFAULT_ORG_CHART_ENABLED)),
    )


async def load_profile_policy(session: AsyncSession, organization_id: UUID) -> ResolvedProfilePolicy:
    """The org's effective policy; a missing row resolves to defaults."""
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, PEOPLE_NAMESPACE)
    row = rows.get(POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ResolvedProfilePolicy(organization_id=organization_id)
    return _from_blob(organization_id, row.value)


async def save_profile_policy(
    session: AsyncSession,
    *,
    policy: ResolvedProfilePolicy,
    updated_by_user_id: UUID,
) -> None:
    """Upsert the org's policy blob (caller commits)."""
    await OrgSettingsOperations(session).set(
        organization_id=policy.organization_id,
        namespace=PEOPLE_NAMESPACE,
        key=POLICY_KEY,
        value={
            "directory_enabled": policy.directory_enabled,
            "org_chart_enabled": policy.org_chart_enabled,
        },
        updated_by_user_id=updated_by_user_id,
    )
