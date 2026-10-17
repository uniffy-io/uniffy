from collections.abc import Awaitable, Callable, Collection
from uuid import UUID

import pycrdt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text, seed_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType, RecurrencePattern
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.realtime import (
    EventRealtimePersistence,
    load_live_event,
)
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden


class EventRealtimeAdapter:
    content_type = ContentType.CALENDAR_EVENT

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        *,
        checker: PermissionChecker | None = None,
    ) -> ContentRole | None:
        event = await load_live_event(session, content_id, organization_id)
        if event is None:
            return None
        if event.recurrence_id is None and event.recurrence_pattern != RecurrencePattern.NONE:
            return None
        # Grants, blocks and attendee rows live on the row itself, the same as ordinary reads.
        operations = EventContentOperations(session, permission_checker=checker)
        role = await operations._resolve_role(user_id, organization_id, event)
        if role is None:
            return None
        is_attendee = await operations._is_attendee(user_id, organization_id, event.id)
        if event_details_hidden(event, user_id, role, is_attendee):
            return None
        if event.recurrence_id is not None:
            # Master visibility is not copied onto override rows; keep it as a privacy floor.
            master = await load_live_event(session, event.recurrence_id, organization_id)
            if master is None or event_details_hidden(master, user_id, role, is_attendee):
                return None
        return role

    async def authorize_many(
        self,
        session: AsyncSession,
        user_ids: Collection[UUID],
        organization_id: UUID,
        content_id: UUID,
    ) -> dict[UUID, ContentRole | None]:
        event = await load_live_event(session, content_id, organization_id)
        if event is None or (
            event.recurrence_id is None and event.recurrence_pattern != RecurrencePattern.NONE
        ):
            return dict.fromkeys(user_ids)
        master = None
        if event.recurrence_id is not None:
            master = await load_live_event(session, event.recurrence_id, organization_id)
            if master is None:
                return dict.fromkeys(user_ids)
        checker = PermissionChecker(session)
        roles = await checker.effective_roles(
            user_ids,
            organization_id,
            ContentType.CALENDAR_EVENT,
            event.id,
            owner_id=event.owner_id,
            access_mode=event.access_mode,
            baseline_role=event.baseline_role,
        )
        attendees = set(
            (
                await session.execute(
                    select(EventAttendee.user_id)
                    .join(User, User.id == EventAttendee.user_id)
                    .join(OrganizationMember, OrganizationMember.user_id == User.id)
                    .join(Organization, Organization.id == OrganizationMember.organization_id)
                    .where(
                        EventAttendee.event_id == event.id,
                        EventAttendee.user_id.in_(user_ids),
                        User.is_active.is_(True),
                        OrganizationMember.organization_id == organization_id,
                        OrganizationMember.is_active.is_(True),
                        Organization.deleted_at.is_(None),
                        Organization.is_suspended.is_(False),
                    )
                )
            ).scalars()
        )
        for user_id, role in roles.items():
            is_attendee = user_id in attendees
            if (
                role is None
                and is_attendee
                and not await checker.is_blocked(
                    user_id,
                    organization_id,
                    ContentType.CALENDAR_EVENT,
                    event.id,
                )
            ):
                role = ContentRole.VIEWER
            if event_details_hidden(event, user_id, role, is_attendee) or (
                master is not None and event_details_hidden(master, user_id, role, is_attendee)
            ):
                role = None
            roles[user_id] = role
        return roles

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        event = await load_live_event(session, content_id, organization_id)
        if event is not None and event.recurrence_id is not None:
            return ContentType.CALENDAR_EVENT, event.recurrence_id
        return None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        event = await load_live_event(session, content_id, organization_id)
        if event is not None:
            seed_markdown(ydoc, event.description or "")

    async def stage_render(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
        *,
        actor_id: UUID | None = None,
    ) -> Callable[[], Awaitable[None]] | None:
        staged = await EventRealtimePersistence(session, self.search_indexer).stage_save(
            organization_id,
            content_id,
            str(markdown_text(ydoc)),
            actor_id=actor_id,
        )
        return staged[1] if staged is not None else None

    async def after_projection(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> None:
        await EventRealtimePersistence(session, self.search_indexer).after_projection(
            organization_id, content_id
        )


def register_event_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(EventRealtimeAdapter(search_indexer))
