"""Calendar operations extending BaseContentOperations."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.shared import (
    AttendeeRole,
    AttendeeStatus,
    CalendarType,
    RecurrencePattern,
    VisibilityScope,
)
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.calendar import queries


class CalendarEventOperations(BaseContentOperations[CalendarEvent]):
    """
    Calendar event CRUD operations with permissions and search.

    Extends BaseContentOperations to provide event-specific functionality
    including attendee management, recurrence, and date range queries.
    """

    content_type = ContentType.CALENDAR_EVENT
    model_class = CalendarEvent

    def __init__(self, session: AsyncSession) -> None:
        """Initialize event operations."""
        super().__init__(session)

    # ─────────────────────────────────────────────────────────────
    # Abstract method implementations
    # ─────────────────────────────────────────────────────────────

    def _build_search_keywords(self, model: CalendarEvent) -> str:
        """
        Build search keywords from event content.

        Tags are prefixed with 'tag:' to enable filtered search queries.
        """
        parts = [model.title]
        if model.tags:
            parts.extend(f"tag:{tag}" for tag in model.tags)
        if model.description:
            parts.append(model.description)
        if model.location:
            parts.append(model.location)
        return " ".join(parts)

    def _get_search_title(self, model: CalendarEvent) -> str:
        """Get event title for search."""
        return model.title

    def _get_url_path(self, model: CalendarEvent) -> str:
        """Get URL path for event."""
        return f"/calendar?event={model.id}"

    def _get_search_description(self, model: CalendarEvent) -> str | None:
        """Get search description from event."""
        if model.description:
            return model.description[:200]
        return None

    def _get_search_tags(self, model: CalendarEvent) -> list[str] | None:
        """Get tags for search index."""
        return model.tags if model.tags else None

    def _get_owner_id_column(self) -> InstrumentedAttribute:
        """Get the organizer_id column (owner equivalent for events)."""
        return CalendarEvent.organizer_id

    # ─────────────────────────────────────────────────────────────
    # Event-specific operations
    # ─────────────────────────────────────────────────────────────

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        start_time: datetime,
        end_time: datetime,
        calendar_id: UUID,
        description: str = "",
        is_all_day: bool = False,
        timezone: str = "UTC",
        location: str = "",
        meeting_url: str | None = None,
        category_id: UUID | None = None,
        attendee_ids: list[UUID] | None = None,
        recurrence_pattern: RecurrencePattern = RecurrencePattern.NONE,
        recurrence_config: dict | None = None,
        is_focus_time: bool = False,
        tags: list[str] | None = None,
        linked_resources: list[dict] | None = None,
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
        group_ids: list[UUID] | None = None,
    ) -> CalendarEvent:
        """
        Create a new calendar event.

        Parameters
        ----------
        user_id : UUID
            Organizer user ID.
        organization_id : UUID
            Organization ID.
        title : str
            Event title.
        start_time : datetime
            Event start time.
        end_time : datetime
            Event end time.
        calendar_id : UUID
            Calendar to place event in.
        description : str
            Event description in markdown.
        is_all_day : bool
            Whether this is an all-day event.
        timezone : str
            Timezone identifier.
        location : str
            Event location.
        meeting_url : str | None
            Meeting URL.
        category_id : UUID | None
            Category for color coding.
        attendee_ids : list[UUID] | None
            User IDs to invite.
        recurrence_pattern : RecurrencePattern
            Recurrence type.
        recurrence_config : dict | None
            Recurrence configuration.
        is_focus_time : bool
            Whether this is focus/deep work time.
        tags : list[str] | None
            List of tags.
        linked_resources : list[dict] | None
            Linked resources (notes, files, chats).
        visibility : VisibilityScope
            Who can access this event.
        group_ids : list[UUID] | None
            Groups to share with (for GROUP visibility).

        Returns
        -------
        CalendarEvent
            Created event.

        """
        # Extract URN references from description
        outgoing_refs = queries.extract_urns_from_content(description) if description else None

        event = CalendarEvent(
            organization_id=organization_id,
            organizer_id=user_id,
            calendar_id=calendar_id,
            title=title,
            description=description,
            start_time=start_time,
            end_time=end_time,
            is_all_day=is_all_day,
            timezone=timezone,
            location=location,
            meeting_url=meeting_url,
            category_id=category_id,
            visibility=visibility,
            is_focus_time=is_focus_time,
            recurrence_pattern=recurrence_pattern,
            recurrence_config=recurrence_config,
            tags=tags,
            linked_resources=linked_resources,
            outgoing_references=outgoing_refs,
        )
        self.session.add(event)
        await self.session.flush()

        # Add organizer as attendee
        organizer_attendee = EventAttendee(
            event_id=event.id,
            user_id=user_id,
            status=AttendeeStatus.ACCEPTED,
            role=AttendeeRole.ORGANIZER,
            responded_at=datetime.now(UTC),
        )
        self.session.add(organizer_attendee)

        # Add other attendees
        if attendee_ids:
            for attendee_id in attendee_ids:
                if attendee_id != user_id:  # Don't duplicate organizer
                    attendee = EventAttendee(
                        event_id=event.id,
                        user_id=attendee_id,
                        status=AttendeeStatus.PENDING,
                        role=AttendeeRole.REQUIRED,
                    )
                    self.session.add(attendee)

        # Create group links if visibility is GROUP
        if visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(
                content_id=event.id,
                organization_id=organization_id,
                user_id=user_id,
                group_ids=group_ids,
            )

        await self.session.commit()
        await self.session.refresh(event)

        # Index for search
        await self._index_for_search(
            model=event,
            group_ids=group_ids if visibility == VisibilityScope.GROUP else None,
        )
        await self.session.commit()

        return event

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        title: str | None = None,
        description: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        is_all_day: bool | None = None,
        timezone: str | None = None,
        location: str | None = None,
        meeting_url: str | None = None,
        calendar_id: UUID | None = None,
        category_id: UUID | None = None,
        recurrence_config: dict | None = None,
        is_focus_time: bool | None = None,
        tags: list[str] | None = None,
        linked_resources: list[dict] | None = None,
        attendee_ids: list[UUID] | None = None,
        visibility: VisibilityScope | None = None,
    ) -> CalendarEvent:
        """
        Update an existing event.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event to update.
        ... : (other parameters)
            Fields to update (None = no change).
        attendee_ids : list[UUID] | None
            New list of attendees (replaces existing).

        Returns
        -------
        CalendarEvent
            Updated event.

        """
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        # Apply updates
        if title is not None:
            event.title = title
        if description is not None:
            event.description = description
            event.outgoing_references = queries.extract_urns_from_content(description) or None
        if start_time is not None:
            event.start_time = start_time
        if end_time is not None:
            event.end_time = end_time
        if is_all_day is not None:
            event.is_all_day = is_all_day
        if timezone is not None:
            event.timezone = timezone
        if location is not None:
            event.location = location
        if meeting_url is not None:
            event.meeting_url = meeting_url
        if calendar_id is not None:
            event.calendar_id = calendar_id
        if category_id is not None:
            event.category_id = category_id
        if recurrence_config is not None:
            event.recurrence_config = recurrence_config
            if recurrence_config.get("pattern"):
                event.recurrence_pattern = RecurrencePattern(recurrence_config["pattern"])
        if is_focus_time is not None:
            event.is_focus_time = is_focus_time
        if tags is not None:
            event.tags = tags
        if linked_resources is not None:
            event.linked_resources = linked_resources
        if visibility is not None:
            event.visibility = visibility

        # Update attendees
        if attendee_ids is not None:
            # Fetch existing attendees
            stmt = select(EventAttendee).where(EventAttendee.event_id == event.id)
            result = await self.session.execute(stmt)
            existing_attendees = result.scalars().all()
            existing_map = {a.user_id: a for a in existing_attendees}

            # Don't touch the organizer (who is also an attendee usually)
            # but let's handle if organizer is passed or not in the list.
            # Logic: If passing a new list, synchronize it.

            # Identify current and new sets
            current_ids = set(existing_map.keys())

            # Ensure organizer is implicitly in the new list if they are an attendee?
            # Or just rely on what frontend sends.
            # Usually organizer is an attendee with role=ORGANIZER.
            # If the backend previously added organizer as attendee, we should probably keep them.
            # But simpler logic: sync to what is provided, but handle organizer separately or
            # assume frontend sends full list.

            # Let's trust the input list but skip re-adding existing ones.
            new_ids = set(attendee_ids)

            # Remove attendees not in new list (except maybe organizer if not in list?)
            # Usually organizer cannot be removed.
            for user_id in current_ids - new_ids:
                attendee = existing_map[user_id]
                if attendee.user_id != event.organizer_id:  # Prevent removing organizer
                    await self.session.delete(attendee)

            # Add new attendees
            for user_id in new_ids - current_ids:
                if user_id != event.organizer_id:  # Organizer added on create, or check if missing
                    attendee = EventAttendee(
                        event_id=event.id,
                        user_id=user_id,
                        status=AttendeeStatus.PENDING,
                        role=AttendeeRole.REQUIRED,
                    )
                    self.session.add(attendee)

        event.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(event)

        # Update search index
        group_ids = await self._get_content_group_ids(event.id)
        await self._index_for_search(model=event, group_ids=group_ids)
        await self.session.commit()

        return event

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """
        Delete an event (soft or permanent).

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event to delete.
        permanent : bool
            If True, permanently delete.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_delete(user_id, organization_id, event)

        if permanent:
            await queries.permanent_delete_event(self.session, event)
        else:
            await queries.soft_delete_event(self.session, event)

        # Remove from search index
        await self.search_indexer.remove(build_content_urn(self.content_type, event_id))
        await self.session.commit()

        return True

    async def get_events_in_range(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_date: datetime,
        end_date: datetime,
        calendar_ids: list[UUID] | None = None,
        category_ids: list[UUID] | None = None,
    ) -> list[CalendarEvent]:
        """
        Get events in a date range with permission filtering.

        Parameters
        ----------
        user_id : UUID
            User requesting events.
        organization_id : UUID
            Organization ID.
        start_date : datetime
            Start of range.
        end_date : datetime
            End of range.
        calendar_ids : list[UUID] | None
            Filter by calendars.
        category_ids : list[UUID] | None
            Filter by categories.

        Returns
        -------
        list[CalendarEvent]
            Events the user can access.

        """
        all_events = await queries.get_events_in_range(
            session=self.session,
            organization_id=organization_id,
            start_date=start_date,
            end_date=end_date,
            calendar_ids=calendar_ids,
            category_ids=category_ids,
        )

        # Filter by permissions
        accessible = []
        for event in all_events:
            can_access = await self.permission_checker.can_access_content(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id=event.id,
                content_owner_id=event.organizer_id,
                content_visibility=event.visibility,
            )
            if can_access:
                accessible.append(event)

        return accessible

    async def list_events(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID | None = None,
        category_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        include_deleted: bool = False,
        tags: list[str] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "start_time",
        sort_order: str = "asc",
    ) -> tuple[list[CalendarEvent], int]:
        """
        List events with filters and pagination.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        calendar_id : UUID | None
            Filter by calendar.
        category_id : UUID | None
            Filter by category.
        start_date : datetime | None
            Filter by start date.
        end_date : datetime | None
            Filter by end date.
        include_deleted : bool
            Include soft-deleted events.
        tags : list[str] | None
            Filter by tags.
        page : int
            Page number.
        page_size : int
            Items per page.
        sort_by : str
            Sort column.
        sort_order : str
            Sort direction.

        Returns
        -------
        tuple[list[CalendarEvent], int]
            Events and total count.

        """
        query = select(CalendarEvent).where(CalendarEvent.organization_id == organization_id)

        # Apply access filter
        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=CalendarEvent.id,
            owner_id_column=CalendarEvent.organizer_id,
            visibility_column=CalendarEvent.visibility,
        )

        # Also include events where user is an attendee
        attendee_subquery = (
            select(EventAttendee.event_id)
            .where(EventAttendee.user_id == user_id)
            .where(EventAttendee.status != AttendeeStatus.DECLINED)
        )
        attendee_filter = CalendarEvent.id.in_(attendee_subquery)

        # Combine access filter with attendee filter
        query = query.where(or_(access_filter, attendee_filter))

        # Apply filters
        if calendar_id:
            query = query.where(CalendarEvent.calendar_id == calendar_id)

        if category_id:
            query = query.where(CalendarEvent.category_id == category_id)

        if start_date:
            query = query.where(CalendarEvent.start_time >= start_date)

        if end_date:
            query = query.where(CalendarEvent.end_time <= end_date)

        if not include_deleted:
            query = query.where(CalendarEvent.is_deleted == False)  # noqa: E712

        if tags:
            for tag in tags:
                query = query.where(CalendarEvent.tags.contains([tag]))

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort
        sort_col = getattr(CalendarEvent, sort_by, CalendarEvent.start_time)
        if sort_order == "desc":
            query = query.order_by(sort_col.desc())
        else:
            query = query.order_by(sort_col.asc())

        # Paginate
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        events = list(result.scalars().all())

        return events, total

    async def get_event_with_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
    ) -> tuple[CalendarEvent, list[tuple[EventAttendee, dict]]]:
        """
        Get event with attendee details.

        Parameters
        ----------
        user_id : UUID
            User requesting event.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event ID.

        Returns
        -------
        tuple[CalendarEvent, list[tuple[EventAttendee, dict]]]
            Event and attendee list.

        """
        event = await self.get_by_id(user_id, organization_id, event_id)
        attendees = await queries.get_event_attendees(self.session, event_id)
        return event, attendees

    async def add_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
        role: AttendeeRole = AttendeeRole.REQUIRED,
    ) -> CalendarEvent:
        """
        Add attendees to an event.

        Parameters
        ----------
        user_id : UUID
            User performing action.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event ID.
        attendee_ids : list[UUID]
            User IDs to add.
        role : AttendeeRole
            Role for new attendees.

        Returns
        -------
        CalendarEvent
            Updated event.

        """
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        # Get existing attendee IDs
        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == event_id)
        )
        existing_ids = {row[0] for row in result.all()}

        # Add new attendees
        for attendee_id in attendee_ids:
            if attendee_id not in existing_ids:
                attendee = EventAttendee(
                    event_id=event_id,
                    user_id=attendee_id,
                    status=AttendeeStatus.PENDING,
                    role=role,
                )
                self.session.add(attendee)

        event.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(event)

        return event

    async def remove_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
    ) -> CalendarEvent:
        """
        Remove attendees from an event.

        Parameters
        ----------
        user_id : UUID
            User performing action.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event ID.
        attendee_ids : list[UUID]
            User IDs to remove.

        Returns
        -------
        CalendarEvent
            Updated event.

        """
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        # Cannot remove organizer
        if event.organizer_id in attendee_ids:
            raise PermissionDeniedError("remove", "event organizer")

        # Remove attendees
        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id.in_(attendee_ids),
                )
            )
        )
        for attendee in result.scalars().all():
            await self.session.delete(attendee)

        event.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(event)

        return event

    async def update_attendee_status(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        status: AttendeeStatus,
    ) -> bool:
        """
        Update the current user's attendee status for an event.

        Parameters
        ----------
        user_id : UUID
            User updating their status.
        organization_id : UUID
            Organization ID.
        event_id : UUID
            Event ID.
        status : AttendeeStatus
            New status.

        Returns
        -------
        bool
            True if updated successfully.

        """
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        # Find user's attendee record
        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id == user_id,
                )
            )
        )
        attendee = result.scalar_one_or_none()
        if not attendee:
            raise NotFoundError("EventAttendee", user_id)

        attendee.status = status
        attendee.responded_at = datetime.now(UTC)
        attendee.updated_at = datetime.now(UTC)

        await self.session.commit()
        return True


class CalendarOperations:
    """
    Calendar CRUD operations.

    Calendars are user-owned and don't have visibility/permission
    complexity like events, so simpler operations.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize calendar operations."""
        self.session = session

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        color: str = "#3b82f6",
        calendar_type: CalendarType = CalendarType.PERSONAL,
        is_default: bool = False,
    ) -> Calendar:
        """Create a new calendar."""
        # If this is the default, unset other defaults
        if is_default:
            result = await self.session.execute(
                select(Calendar).where(
                    and_(
                        Calendar.organization_id == organization_id,
                        Calendar.owner_id == user_id,
                        Calendar.is_default == True,  # noqa: E712
                    )
                )
            )
            for cal in result.scalars().all():
                cal.is_default = False

        calendar = Calendar(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            color=color,
            calendar_type=calendar_type,
            is_visible=True,
            is_default=is_default,
        )
        self.session.add(calendar)
        await self.session.commit()
        await self.session.refresh(calendar)
        return calendar

    async def get_by_id(
        self,
        calendar_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> Calendar:
        """Get calendar by ID (must be owner)."""
        result = await self.session.execute(
            select(Calendar).where(
                and_(
                    Calendar.id == calendar_id,
                    Calendar.organization_id == organization_id,
                    Calendar.owner_id == user_id,
                )
            )
        )
        calendar = result.scalar_one_or_none()
        if not calendar:
            raise NotFoundError("Calendar", calendar_id)
        return calendar

    async def update(
        self,
        calendar_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        name: str | None = None,
        color: str | None = None,
        is_visible: bool | None = None,
        is_default: bool | None = None,
        calendar_type: CalendarType | None = None,
    ) -> Calendar:
        """Update a calendar."""
        calendar = await self.get_by_id(calendar_id, organization_id, user_id)

        if name is not None:
            calendar.name = name
        if color is not None:
            calendar.color = color
        if is_visible is not None:
            calendar.is_visible = is_visible
        if is_default is not None:
            if is_default:
                # Unset other defaults
                result = await self.session.execute(
                    select(Calendar).where(
                        and_(
                            Calendar.organization_id == organization_id,
                            Calendar.owner_id == user_id,
                            Calendar.is_default == True,  # noqa: E712
                            Calendar.id != calendar_id,
                        )
                    )
                )
                for cal in result.scalars().all():
                    cal.is_default = False
            calendar.is_default = is_default
        if calendar_type is not None:
            calendar.calendar_type = calendar_type

        calendar.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(calendar)
        return calendar

    async def delete(
        self,
        calendar_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Delete a calendar."""
        calendar = await self.get_by_id(calendar_id, organization_id, user_id)

        # Don't allow deleting the default calendar
        if calendar.is_default:
            raise PermissionDeniedError("delete", "default calendar")

        await self.session.delete(calendar)
        await self.session.commit()
        return True

    async def list_calendars(
        self,
        organization_id: UUID,
        user_id: UUID,
        visible_only: bool = False,
    ) -> list[Calendar]:
        """List user's calendars."""
        return await queries.get_user_calendars(self.session, organization_id, user_id, visible_only)

    async def ensure_default(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> Calendar:
        """Ensure user has a default calendar."""
        return await queries.ensure_default_calendar(self.session, organization_id, user_id)


class CategoryOperations:
    """
    Category CRUD operations.

    Categories are organization-wide and require org membership verification.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize category operations."""
        self.session = session

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """
        Verify user is an active member of the organization.

        Parameters
        ----------
        user_id : UUID
            User ID to verify.
        organization_id : UUID
            Organization ID to check membership for.

        Raises
        ------
        PermissionDeniedError
            If user is not an active member of the organization.

        """
        result = await self.session.execute(
            select(OrganizationMember).where(
                and_(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active == True,  # noqa: E712
                )
            )
        )
        membership = result.scalar_one_or_none()

        if not membership:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        color: str,
        icon: str | None = None,
    ) -> Category:
        """Create a new category."""
        await self._verify_org_membership(user_id, organization_id)

        # Get next sort order
        result = await self.session.execute(
            select(func.max(Category.sort_order)).where(Category.organization_id == organization_id)
        )
        max_order = result.scalar() or 0

        category = Category(
            organization_id=organization_id,
            name=name,
            color=color,
            icon=icon,
            is_default=False,
            sort_order=max_order + 1,
        )
        self.session.add(category)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def get_by_id(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> Category:
        """Get category by ID."""
        await self._verify_org_membership(user_id, organization_id)

        result = await self.session.execute(
            select(Category).where(
                and_(
                    Category.id == category_id,
                    Category.organization_id == organization_id,
                )
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("Category", category_id)
        return category

    async def update(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
        name: str | None = None,
        color: str | None = None,
        icon: str | None = None,
        sort_order: int | None = None,
    ) -> Category:
        """Update a category."""
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        if name is not None:
            category.name = name
        if color is not None:
            category.color = color
        if icon is not None:
            category.icon = icon
        if sort_order is not None:
            category.sort_order = sort_order

        category.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def delete(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Delete a category."""
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        # Don't allow deleting default categories
        if category.is_default:
            raise PermissionDeniedError("delete", "default category")

        await self.session.delete(category)
        await self.session.commit()
        return True

    async def list_categories(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        """List all categories for an organization."""
        await self._verify_org_membership(user_id, organization_id)
        return await queries.get_categories(self.session, organization_id)

    async def ensure_defaults(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        """Ensure organization has default categories."""
        await self._verify_org_membership(user_id, organization_id)
        return await queries.ensure_default_categories(self.session, organization_id)


class EventTemplateOperations:
    """
    EventTemplate CRUD operations.

    Templates are organization-wide or private.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize template operations."""
        self.session = session

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """
        Verify user is an active member of the organization.
        """
        result = await self.session.execute(
            select(OrganizationMember).where(
                and_(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active == True,  # noqa: E712
                )
            )
        )
        membership = result.scalar_one_or_none()

        if not membership:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        description: str = "",
        duration_minutes: int = 30,
        location: str = "",
        meeting_url: str | None = None,
        category_id: UUID | None = None,
        tags: list[str] | None = None,
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> EventTemplate:
        await self._verify_org_membership(user_id, organization_id)

        template = EventTemplate(
            organization_id=organization_id,
            title=title,
            description=description,
            duration_minutes=duration_minutes,
            location=location,
            meeting_url=meeting_url,
            category_id=category_id,
            tags=tags or [],
            visibility=visibility,
            created_by=user_id,
        )
        self.session.add(template)
        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def get_by_id(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> EventTemplate:
        await self._verify_org_membership(user_id, organization_id)

        query = select(EventTemplate).where(
            and_(
                EventTemplate.id == template_id,
                EventTemplate.organization_id == organization_id,
            )
        )
        result = await self.session.execute(query)
        template = result.scalar_one_or_none()

        if not template:
            raise NotFoundError(EventTemplate, template_id)

        # Check visibility
        if template.visibility == VisibilityScope.PRIVATE and template.created_by != user_id:
            raise PermissionDeniedError("read", "event template")

        return template

    async def update(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        **kwargs,
    ) -> EventTemplate:
        template = await self.get_by_id(template_id, organization_id, user_id)

        # Only creator can edit
        if template.created_by != user_id:
            raise PermissionDeniedError("update", "event template")

        for key, value in kwargs.items():
            if hasattr(template, key):
                setattr(template, key, value)

        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def delete(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        template = await self.get_by_id(template_id, organization_id, user_id)

        if template.created_by != user_id:
            raise PermissionDeniedError("delete", "event template")

        await self.session.delete(template)
        await self.session.commit()
        return True

    async def list(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> list[EventTemplate]:
        await self._verify_org_membership(user_id, organization_id)

        query = select(EventTemplate).where(
            and_(
                EventTemplate.organization_id == organization_id,
                or_(
                    EventTemplate.visibility != VisibilityScope.PRIVATE,
                    EventTemplate.created_by == user_id,
                ),
            )
        )

        result = await self.session.execute(query)
        return result.scalars().all()
