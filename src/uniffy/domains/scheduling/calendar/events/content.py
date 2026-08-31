"""Calendar operations."""

from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import (
    ContentRole,
    ContentType,
)
from uniffy.domains.scheduling.calendar.events.state import _master_event_id
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="scheduling.calendar.events.content")


class EventContentOperations(BaseContentOperations[CalendarEvent]):
    """Calendar event search and access policy."""

    content_type = ContentType.CALENDAR_EVENT
    model_class = CalendarEvent

    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        super().__init__(session, search_indexer)

    def _build_search_keywords(self, model: CalendarEvent) -> str:
        # Tag slugs land in the dedicated `tags` array via
        # `_get_search_tags_async`; not duplicated here.
        parts = [model.title]
        if model.description:
            parts.append(model.description)
        if model.location:
            parts.append(model.location)
        return " ".join(parts)

    def _get_search_title(self, model: CalendarEvent) -> str:
        return model.title

    def _get_url_path(self, model: CalendarEvent) -> str:
        return f"/calendar?event={model.id}"

    def _get_search_description(self, model: CalendarEvent) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    async def _get_search_tags_async(self, model: CalendarEvent) -> list[str] | None:
        # Recurring instances inherit the master's tag set; resolve to master.
        urn = build_content_urn(self.content_type, _master_event_id(model))
        tag_ops = TagOperations(self.session)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _get_search_metadata(self, model: CalendarEvent) -> dict[str, str] | None:
        """Return event details metadata for search."""
        metadata: dict[str, str] = {}
        if model.start_time:
            metadata["start_time"] = model.start_time.isoformat()
        if model.end_time:
            metadata["end_time"] = model.end_time.isoformat()
        if model.location:
            metadata["location"] = model.location
        if model.timezone:
            metadata["timezone"] = model.timezone
        metadata["is_all_day"] = str(model.is_all_day).lower()
        metadata["event_status"] = model.status.value
        # `metadata.visibility` is filterable: the permission filter hides
        # PRIVATE documents from everyone but the organizer and attendees.
        metadata["visibility"] = model.visibility.value
        return metadata if metadata else None

    def _get_owner_id_column(self) -> InstrumentedAttribute:
        """Events use `organizer_id` instead of `owner_id`."""
        return CalendarEvent.organizer_id

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: CalendarEvent,
    ) -> ContentRole | None:
        """Content permissions first, then the attendee floor.

        An invitation is an explicit grant by the organizer, so an attendee can
        VIEW an event regardless of its access mode - mirroring the attendee
        bypass in the list queries. An explicit BLOCKED grant still wins.
        """
        # Expanded occurrences carry a synthetic string id; permissions live on
        # the master row, so every lookup below resolves to the master UUID.
        master_id = _master_event_id(content)
        role = await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=master_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if role is not None:
            return role

        if not await self._is_attendee(user_id, organization_id, master_id):
            return None

        if await self.permission_checker.is_blocked(
            user_id, organization_id, self.content_type, master_id
        ):
            return None

        return ContentRole.VIEWER

    async def _is_attendee(self, user_id: UUID, organization_id: UUID, event_id: UUID) -> bool:
        """An invitation is a grant only while the invitee is still an active
        member of the org.

        ``effective_role`` has already returned ``None`` by the time this runs,
        and lost membership is one of the reasons it does. Without the join,
        removal would leave every event the user was ever invited to readable,
        because ``remove_member`` does not delete attendee rows.
        """
        if not await self.access_query.is_active_member(user_id, organization_id):
            return False

        result = await self.session.execute(
            select(EventAttendee.id)
            .where(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == user_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def attendee_access_filter(self, user_id: UUID, organization_id: UUID):
        """WHERE branch granting invitees visibility, minus explicit BLOCKED grants.

        The membership EXISTS is uncorrelated, so it collapses to a constant
        for the query rather than running per row. It mirrors the same
        condition in ``_is_attendee``.
        """
        attendee_subquery = select(EventAttendee.event_id).where(
            EventAttendee.user_id == user_id,
        )
        if not await self.access_query.is_active_member(user_id, organization_id):
            return False
        return and_(
            CalendarEvent.id.in_(attendee_subquery),
            self.access_query.build_not_blocked_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=CalendarEvent.id,
            ),
        )

    async def _get_search_attendee_user_ids(self, model: CalendarEvent) -> list[UUID] | None:
        # Recurring instances resolve to the master, same as tags; override rows
        # carry their own copied attendee set.
        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == _master_event_id(model))
        )
        ids = [row[0] for row in result.all()]
        return ids or None

    async def _refresh_search_attendees(self, event: CalendarEvent) -> None:
        """Push the current attendee set into the search document; best-effort."""
        try:
            attendee_ids = await self._get_search_attendee_user_ids(event)
            await self.search_indexer.update_attendees(
                urn=build_content_urn(self.content_type, event.id),
                organization_id=event.organization_id,
                attendee_user_ids=attendee_ids or [],
            )
        except Exception:
            logger.opt(exception=True).warning("Failed to refresh attendee search sharing")

    async def _publish_attendee_access_change(
        self,
        event: CalendarEvent,
        attendee_ids: list[UUID],
        action: ContentAccessAction,
    ) -> None:
        if not attendee_ids:
            return
        try:
            await publish_content_access_changed(
                content_type=content_type_to_proto(self.content_type),
                content_id=event.id,
                action=action,
                organization_id=event.organization_id,
                target_user_ids=list(dict.fromkeys(attendee_ids)),
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to publish calendar attendee access change",
                event_id=str(event.id),
                action=action,
            )
