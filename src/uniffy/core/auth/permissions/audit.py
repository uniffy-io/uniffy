"""Audit-log helpers for content membership and access policy changes.

Every mutation in :class:`ContentMembersOperations` (or any other code
path that changes a content item's access policy or its members) calls
one of these helpers to append an immutable row to ``audit_events``
via :func:`uniffy.core.audit.write_audit_event`.

The helpers shape the central writer's call for each kind of change:

- ``resource_type`` is the affected ``ContentType.value`` (e.g.
  ``"NOTE"``).
- ``resource_id`` is the content's id.
- ``details`` packs the action-specific structured payload that the
  ``permissions.v1.MembersService.ListMemberEvents`` converter unpacks
  back into the ``ContentMemberEvent`` proto shape.

Helpers take the caller's session and never commit - the audit row
rides the surrounding transaction so history stays consistent with
state. The actor's organization-role snapshot is captured by the
writer itself via a per-write ``SELECT``.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.audit.writer import write_audit_event
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
)


async def record_member_added(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
    new_role: ContentRole,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.member_added event."""
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_MEMBER_ADDED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "subject_type": subject_type.value,
            "subject_id": str(subject_id),
            "new_role": new_role.value,
            "note": note,
        },
    )


async def record_member_role_changed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
    previous_role: ContentRole,
    new_role: ContentRole,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.member_role_changed event."""
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_MEMBER_ROLE_CHANGED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "subject_type": subject_type.value,
            "subject_id": str(subject_id),
            "previous_role": previous_role.value,
            "new_role": new_role.value,
            "note": note,
        },
    )


async def record_member_removed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    subject_type: SubjectType,
    subject_id: UUID,
    previous_role: ContentRole,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.member_removed event."""
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_MEMBER_REMOVED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "subject_type": subject_type.value,
            "subject_id": str(subject_id),
            "previous_role": previous_role.value,
            "note": note,
        },
    )


async def record_access_mode_changed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_access_mode: AccessMode | None,
    new_access_mode: AccessMode | None,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.access_mode_changed event."""
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_ACCESS_MODE_CHANGED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "previous_access_mode": (
                previous_access_mode.value if previous_access_mode else None
            ),
            "new_access_mode": (
                new_access_mode.value if new_access_mode else None
            ),
            "note": note,
        },
    )


async def record_baseline_role_changed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_baseline_role: ContentRole | None,
    new_baseline_role: ContentRole | None,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.baseline_role_changed event."""
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_BASELINE_ROLE_CHANGED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "previous_baseline_role": (
                previous_baseline_role.value if previous_baseline_role else None
            ),
            "new_baseline_role": (
                new_baseline_role.value if new_baseline_role else None
            ),
            "note": note,
        },
    )


async def record_ownership_transferred(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_owner_id: UUID,
    new_owner_id: UUID,
    actor_user_id: UUID,
    note: str = "",
) -> None:
    """Record a permissions.ownership_transferred event.

    ``details.subject_id`` carries the new owner's user id for
    convenience when querying the log by subject (matches the
    ``ContentMemberEvent`` proto convention).
    """
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=Action.PERMISSIONS_OWNERSHIP_TRANSFERRED,
        resource_type=content_type.value,
        resource_id=content_id,
        details={
            "subject_type": SubjectType.USER.value,
            "subject_id": str(new_owner_id),
            "previous_owner_id": str(previous_owner_id),
            "new_owner_id": str(new_owner_id),
            "note": note,
        },
    )
