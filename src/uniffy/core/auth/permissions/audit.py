"""Audit log helpers for content membership and access policy changes.

Every mutation in :class:`ContentMembersOperations` (or any other code
path that changes a content item's access policy or its members) calls
``record_member_event`` to append an immutable row to
``permissions_content_member_events``.

The helpers here build the right event row for each kind of change.
They take a session but never commit -- the caller commits the mutation
and the audit row in the same transaction so the history is perfectly
consistent with the state.

The caller is responsible for providing ``actor_org_role`` (snapshot of
the actor's organization role at the time of the action), usually
obtained from :class:`PermissionChecker.get_user_org_role`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    SubjectType,
)

if TYPE_CHECKING:
    from uniffy.core.models.login.organization_member import OrganizationRole
    from uniffy.core.models.permissions.content_member_event import ContentMemberEvent


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
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record a MEMBER_ADDED event. Does not commit."""
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.MEMBER_ADDED,
        subject_type=subject_type,
        subject_id=subject_id,
        previous_role=None,
        new_role=new_role,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event


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
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record a MEMBER_ROLE_CHANGED event. Does not commit."""
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.MEMBER_ROLE_CHANGED,
        subject_type=subject_type,
        subject_id=subject_id,
        previous_role=previous_role,
        new_role=new_role,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event


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
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record a MEMBER_REMOVED event. Does not commit."""
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.MEMBER_REMOVED,
        subject_type=subject_type,
        subject_id=subject_id,
        previous_role=previous_role,
        new_role=None,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event


async def record_access_mode_changed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_access_mode: AccessMode,
    new_access_mode: AccessMode,
    actor_user_id: UUID,
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record an ACCESS_MODE_CHANGED event. Does not commit."""
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.ACCESS_MODE_CHANGED,
        previous_access_mode=previous_access_mode,
        new_access_mode=new_access_mode,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event


async def record_baseline_role_changed(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_baseline_role: ContentRole | None,
    new_baseline_role: ContentRole | None,
    actor_user_id: UUID,
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record a BASELINE_ROLE_CHANGED event. Does not commit."""
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.BASELINE_ROLE_CHANGED,
        previous_baseline_role=previous_baseline_role,
        new_baseline_role=new_baseline_role,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event


async def record_ownership_transferred(
    session: AsyncSession,
    *,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    previous_owner_id: UUID,
    new_owner_id: UUID,
    actor_user_id: UUID,
    actor_org_role: OrganizationRole,
    note: str = "",
) -> ContentMemberEvent:
    """Record an OWNERSHIP_TRANSFERRED event. Does not commit.

    The ``subject_id`` field of the event carries the new owner's user id
    for convenience when querying the log by subject.
    """
    event = ContentMemberEvent(
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        action=ContentMemberAction.OWNERSHIP_TRANSFERRED,
        subject_type=SubjectType.USER,
        subject_id=new_owner_id,
        previous_owner_id=previous_owner_id,
        new_owner_id=new_owner_id,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        note=note,
    )
    session.add(event)
    return event
