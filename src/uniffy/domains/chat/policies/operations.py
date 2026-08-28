"""Per-org chat policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='chat'``, ``key='policy'``. An absent
row means every field takes its built-in default.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.chat.access import ChatAccessChecker

CHAT_NAMESPACE = "chat"
POLICY_KEY = "policy"


class BroadcastMinRole(StrEnum):
    MEMBER = "member"
    ADMIN = "admin"


class EditHistoryVisibility(StrEnum):
    ADMINS = "admins"
    EVERYONE = "everyone"


DEFAULT_BROADCAST_MIN_ROLE = BroadcastMinRole.MEMBER
DEFAULT_BROADCAST_CONFIRM_THRESHOLD = 25
DEFAULT_EDIT_WINDOW_MINUTES = 60
MAX_EDIT_WINDOW_MINUTES = 525_600
DEFAULT_EDIT_HISTORY_VISIBLE_TO = EditHistoryVisibility.ADMINS
DEFAULT_AGENTS_ENABLED = True


@dataclass(frozen=True)
class ResolvedChatPolicy:
    """Effective per-org chat policy; field names mirror the proto message."""

    organization_id: UUID
    broadcast_min_role: BroadcastMinRole = DEFAULT_BROADCAST_MIN_ROLE
    broadcast_confirm_threshold: int = DEFAULT_BROADCAST_CONFIRM_THRESHOLD
    # None = unlimited; 0 = editing disabled.
    edit_window_minutes: int | None = DEFAULT_EDIT_WINDOW_MINUTES
    edit_history_visible_to: EditHistoryVisibility = DEFAULT_EDIT_HISTORY_VISIBLE_TO
    agents_enabled: bool = DEFAULT_AGENTS_ENABLED


def _from_blob(organization_id: UUID, blob: dict) -> ResolvedChatPolicy:
    raw_role = blob.get("broadcast_min_role", DEFAULT_BROADCAST_MIN_ROLE)
    try:
        min_role = BroadcastMinRole(raw_role)
    except ValueError:
        min_role = DEFAULT_BROADCAST_MIN_ROLE
    try:
        threshold = max(
            0, int(blob.get("broadcast_confirm_threshold", DEFAULT_BROADCAST_CONFIRM_THRESHOLD))
        )
    except ValueError, TypeError:
        threshold = DEFAULT_BROADCAST_CONFIRM_THRESHOLD
    # A stored null means unlimited; an absent key means the coded default.
    raw_window = blob.get("edit_window_minutes", DEFAULT_EDIT_WINDOW_MINUTES)
    if raw_window is None:
        edit_window: int | None = None
    else:
        try:
            edit_window = min(MAX_EDIT_WINDOW_MINUTES, max(0, int(raw_window)))
        except ValueError, TypeError:
            edit_window = DEFAULT_EDIT_WINDOW_MINUTES
    try:
        history_visibility = EditHistoryVisibility(
            blob.get("edit_history_visible_to", DEFAULT_EDIT_HISTORY_VISIBLE_TO)
        )
    except ValueError:
        history_visibility = DEFAULT_EDIT_HISTORY_VISIBLE_TO
    return ResolvedChatPolicy(
        organization_id=organization_id,
        broadcast_min_role=min_role,
        broadcast_confirm_threshold=threshold,
        edit_window_minutes=edit_window,
        edit_history_visible_to=history_visibility,
        agents_enabled=bool(blob.get("agents_enabled", DEFAULT_AGENTS_ENABLED)),
    )


async def resolve_chat_policy(session: AsyncSession, organization_id: UUID) -> ResolvedChatPolicy:
    """The org's effective chat policy; a missing or malformed row resolves to defaults."""
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, CHAT_NAMESPACE)
    row = rows.get(POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ResolvedChatPolicy(organization_id=organization_id)
    return _from_blob(organization_id, row.value)


MAX_BROADCAST_CONFIRM_THRESHOLD = 10_000


async def get_chat_policy_view(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> ResolvedChatPolicy:
    """Effective policy for any active org member; the composer reads this."""
    await ChatAccessChecker(session).require_org_member(user_id, organization_id)
    return await resolve_chat_policy(session, organization_id)


async def update_chat_policy(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    broadcast_min_role: BroadcastMinRole,
    broadcast_confirm_threshold: int,
    edit_window_minutes: int | None,
    edit_history_visible_to: EditHistoryVisibility,
    agents_enabled: bool,
) -> ResolvedChatPolicy:
    checker = ChatAccessChecker(session)
    await checker.require_org_member(user_id, organization_id)
    if not await checker.is_org_admin(user_id, organization_id):
        raise PermissionDeniedError("update", "chat policy")
    if not 0 <= broadcast_confirm_threshold <= MAX_BROADCAST_CONFIRM_THRESHOLD:
        raise ValidationError(
            "broadcast_confirm_threshold",
            f"Must be between 0 and {MAX_BROADCAST_CONFIRM_THRESHOLD}",
        )
    if edit_window_minutes is not None and not 0 <= edit_window_minutes <= MAX_EDIT_WINDOW_MINUTES:
        raise ValidationError(
            "edit_window_minutes",
            f"Must be between 0 and {MAX_EDIT_WINDOW_MINUTES}",
        )
    previous = await resolve_chat_policy(session, organization_id)
    policy = ResolvedChatPolicy(
        organization_id=organization_id,
        broadcast_min_role=broadcast_min_role,
        broadcast_confirm_threshold=broadcast_confirm_threshold,
        edit_window_minutes=edit_window_minutes,
        edit_history_visible_to=edit_history_visible_to,
        agents_enabled=agents_enabled,
    )
    await save_chat_policy(session, policy=policy, updated_by_user_id=user_id)
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CHAT_POLICY_UPDATED,
        resource_type=AuditResourceType.CHAT,
        resource_id=organization_id,
        details={
            "broadcast_min_role": policy.broadcast_min_role.value,
            "broadcast_confirm_threshold": policy.broadcast_confirm_threshold,
            "edit_window_minutes": policy.edit_window_minutes,
            "edit_history_visible_to": policy.edit_history_visible_to.value,
            "agents_enabled": policy.agents_enabled,
            "previous_broadcast_min_role": previous.broadcast_min_role.value,
            "previous_broadcast_confirm_threshold": previous.broadcast_confirm_threshold,
            "previous_edit_window_minutes": previous.edit_window_minutes,
            "previous_edit_history_visible_to": previous.edit_history_visible_to.value,
            "previous_agents_enabled": previous.agents_enabled,
        },
    )
    await session.commit()
    return policy


async def save_chat_policy(
    session: AsyncSession,
    *,
    policy: ResolvedChatPolicy,
    updated_by_user_id: UUID,
) -> None:
    """Upsert the org's policy blob (caller commits)."""
    await OrgSettingsOperations(session).set(
        organization_id=policy.organization_id,
        namespace=CHAT_NAMESPACE,
        key=POLICY_KEY,
        value={
            "broadcast_min_role": policy.broadcast_min_role.value,
            "broadcast_confirm_threshold": policy.broadcast_confirm_threshold,
            "edit_window_minutes": policy.edit_window_minutes,
            "edit_history_visible_to": policy.edit_history_visible_to.value,
            "agents_enabled": policy.agents_enabled,
        },
        updated_by_user_id=updated_by_user_id,
    )
