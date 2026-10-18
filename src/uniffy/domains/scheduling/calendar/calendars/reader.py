"""The calendars a member can see, and how each one appears to them."""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import ColumnElement, and_, exists, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.member_settings import CalendarMemberSettings
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content

# Bound each page while allowing every accessible calendar to be discovered.
MAX_LISTED_CALENDARS = 500


class CalendarSection(StrEnum):
    MINE = "MINE"
    SHARED = "SHARED"
    ORGANIZATION = "ORGANIZATION"


@dataclass(frozen=True)
class CalendarListing:
    calendar: Calendar
    section: CalendarSection
    is_hidden: bool


class CalendarReader(BaseContentOperations[Calendar]):
    content_type = ContentType.CALENDAR
    model_class = Calendar

    def __init__(
        self,
        session: AsyncSession,
        *,
        _search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_calendar_content()
        super().__init__(session, _search_indexer)

    def _build_search_keywords(self, model: Calendar) -> str:
        return " ".join(part for part in (model.name, model.description) if part)

    def _get_search_title(self, model: Calendar) -> str:
        return model.name

    def _get_url_path(self, model: Calendar) -> str:
        return f"/calendar?calendar={model.id}"

    def _get_search_description(self, model: Calendar) -> str | None:
        return model.description[:200] if model.description else None

    def _get_search_metadata(self, model: Calendar) -> dict[str, str] | None:
        return {"color": model.color, "calendar_type": model.calendar_type.value}

    def _listing_query(self, user_id: UUID, organization_id: UUID):
        return (
            select(
                Calendar,
                CalendarMemberSettings.is_hidden,
                self._explicitly_shared(user_id, organization_id).label("shared"),
            )
            .outerjoin(
                CalendarMemberSettings,
                and_(
                    CalendarMemberSettings.calendar_id == Calendar.id,
                    CalendarMemberSettings.user_id == user_id,
                ),
            )
            .where(Calendar.organization_id == organization_id, Calendar.is_deleted.is_(False))
        )

    @staticmethod
    def _listing(
        user_id: UUID, calendar: Calendar, is_hidden: bool | None, shared: bool
    ) -> CalendarListing:
        section = (
            CalendarSection.MINE
            if calendar.owner_id == user_id
            else CalendarSection.SHARED
            if shared
            else CalendarSection.ORGANIZATION
        )
        hidden = is_hidden if is_hidden is not None else section == CalendarSection.ORGANIZATION
        return CalendarListing(calendar, section, hidden)

    async def list_calendars(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        after: UUID | None = None,
        limit: int = MAX_LISTED_CALENDARS,
    ) -> list[CalendarListing]:
        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Calendar.id,
            owner_id_column=Calendar.owner_id,
            access_mode_column=Calendar.access_mode,
            baseline_role_column=Calendar.baseline_role,
        )
        query = self._listing_query(user_id, organization_id).where(access_filter)
        if after is not None:
            query = query.where(Calendar.id > after)
        rows = (
            await self.session.execute(
                query.order_by(Calendar.id).limit(min(limit, MAX_LISTED_CALENDARS + 1))
            )
        ).all()
        return [self._listing(user_id, *row) for row in rows]

    async def get_listing(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
    ) -> CalendarListing:
        await self.get_by_id(user_id, organization_id, calendar_id)
        row = (
            await self.session.execute(
                self._listing_query(user_id, organization_id).where(Calendar.id == calendar_id)
            )
        ).one()
        return self._listing(user_id, *row)

    async def count_event_series(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
    ) -> int:
        await self.get_by_id(user_id, organization_id, calendar_id)
        access = await EventContentOperations(self.session).event_access_filter(
            user_id, organization_id
        )
        return (
            await self.session.scalar(
                select(func.count())
                .select_from(CalendarEvent)
                .where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.calendar_id == calendar_id,
                    CalendarEvent.is_deleted.is_(False),
                    CalendarEvent.recurrence_id.is_(None),
                    access,
                )
            )
        ) or 0

    async def event_visibility_filter(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> ColumnElement[bool]:
        """Hide events on calendars the member has hidden.

        Events the member reaches without seeing their calendar - an invitation on
        a colleague's private calendar - follow the member's default calendar.
        Built in SQL rather than from the sidebar list, so no list cap applies.
        """
        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Calendar.id,
            owner_id_column=Calendar.owner_id,
            access_mode_column=Calendar.access_mode,
            baseline_role_column=Calendar.baseline_role,
        )
        # The same default list_calendars applies: organization calendars stay
        # hidden until the member opts in.
        is_hidden = func.coalesce(
            CalendarMemberSettings.is_hidden,
            and_(
                Calendar.owner_id != user_id,
                not_(self._explicitly_shared(user_id, organization_id)),
            ),
        )
        listed = (
            select(Calendar.id)
            .outerjoin(
                CalendarMemberSettings,
                and_(
                    CalendarMemberSettings.calendar_id == Calendar.id,
                    CalendarMemberSettings.user_id == user_id,
                ),
            )
            .where(
                Calendar.organization_id == organization_id,
                Calendar.is_deleted == False,  # noqa: E712
                access_filter,
            )
        )
        default_hidden = await self.session.scalar(
            select(CalendarMemberSettings.is_hidden)
            .join(Calendar, Calendar.id == CalendarMemberSettings.calendar_id)
            .where(
                CalendarMemberSettings.user_id == user_id,
                Calendar.organization_id == organization_id,
                Calendar.owner_id == user_id,
                Calendar.is_default == True,  # noqa: E712
                Calendar.is_deleted == False,  # noqa: E712
            )
        )
        if default_hidden:
            return CalendarEvent.calendar_id.in_(listed.where(not_(is_hidden)))
        return CalendarEvent.calendar_id.notin_(listed.where(is_hidden))

    @staticmethod
    def _explicitly_shared(user_id: UUID, organization_id: UUID):
        """Whether an unexpired, non-blocking grant names the member or one of their groups."""
        user_groups = (
            select(GroupMember.group_id)
            .join(Group, Group.id == GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.is_active.is_(True),
                Group.organization_id == organization_id,
            )
        )
        return exists().where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == ContentType.CALENDAR,
            ContentMember.content_id == Calendar.id,
            ContentMember.role != ContentRole.BLOCKED,
            or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > datetime.now(UTC)),
            or_(
                and_(
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == user_id,
                ),
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(user_groups),
                ),
            ),
        )
