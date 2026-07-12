"""Per-org call policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='calls'``, ``key='policy'``. An absent
row means every field takes its built-in default.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls import ScreenShareQuality
from uniffy.domains.org_settings.operations import OrgSettingsOperations

CALLS_NAMESPACE = "calls"
POLICY_KEY = "policy"

DEFAULT_CALLS_ENABLED = True
DEFAULT_MAX_PARTICIPANTS = 50
DEFAULT_MAX_DURATION_MINUTES = 480
_UNSPECIFIED = int(ScreenShareQuality.UNSPECIFIED)


@dataclass(frozen=True)
class ResolvedCallPolicy:
    """Effective per-org call policy; field names mirror the proto message."""

    organization_id: UUID
    calls_enabled: bool = DEFAULT_CALLS_ENABLED
    max_participants: int = DEFAULT_MAX_PARTICIPANTS
    max_duration_minutes: int = DEFAULT_MAX_DURATION_MINUTES
    max_screen_share_quality_direct: int = _UNSPECIFIED
    max_screen_share_quality_group: int = _UNSPECIFIED
    max_screen_share_quality_channel: int = _UNSPECIFIED


def _from_blob(organization_id: UUID, blob: dict) -> ResolvedCallPolicy:
    return ResolvedCallPolicy(
        organization_id=organization_id,
        calls_enabled=bool(blob.get("calls_enabled", DEFAULT_CALLS_ENABLED)),
        max_participants=int(blob.get("max_participants", DEFAULT_MAX_PARTICIPANTS)),
        max_duration_minutes=int(
            blob.get("max_duration_minutes", DEFAULT_MAX_DURATION_MINUTES)
        ),
        max_screen_share_quality_direct=int(
            blob.get("max_screen_share_quality_direct", _UNSPECIFIED)
        ),
        max_screen_share_quality_group=int(
            blob.get("max_screen_share_quality_group", _UNSPECIFIED)
        ),
        max_screen_share_quality_channel=int(
            blob.get("max_screen_share_quality_channel", _UNSPECIFIED)
        ),
    )


async def load_call_policy(
    session: AsyncSession, organization_id: UUID
) -> ResolvedCallPolicy | None:
    """The org's stored policy, or ``None`` when no row exists."""
    rows = await OrgSettingsOperations(session).get_namespace(
        organization_id, CALLS_NAMESPACE
    )
    row = rows.get(POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return None
    return _from_blob(organization_id, row.value)


async def save_call_policy(
    session: AsyncSession,
    *,
    policy: ResolvedCallPolicy,
    updated_by_user_id: UUID,
) -> None:
    """Upsert the org's policy blob (caller commits)."""
    await OrgSettingsOperations(session).set(
        organization_id=policy.organization_id,
        namespace=CALLS_NAMESPACE,
        key=POLICY_KEY,
        value={
            "calls_enabled": policy.calls_enabled,
            "max_participants": policy.max_participants,
            "max_duration_minutes": policy.max_duration_minutes,
            "max_screen_share_quality_direct": policy.max_screen_share_quality_direct,
            "max_screen_share_quality_group": policy.max_screen_share_quality_group,
            "max_screen_share_quality_channel": policy.max_screen_share_quality_channel,
        },
        updated_by_user_id=updated_by_user_id,
    )
