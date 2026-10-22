"""The reviewer inbox: one period, every person the actor reviews, with totals and day meters."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.errors import ValidationError
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.models.projects.timesheet import TimePeriodStatus, Timesheet, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.capacity import required_minutes_on, workdays_for_users
from uniffy.domains.projects.time.closures import PeriodOperations, PeriodView
from uniffy.domains.projects.time.locks import sheet_is_locked
from uniffy.domains.projects.time.periods import period_for
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, load_time_policy
from uniffy.domains.projects.time.timesheets import SheetView

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@dataclass(frozen=True)
class DayTotalView:
    day: date
    minutes: int
    required_minutes: int


@dataclass(frozen=True)
class ReviewRow:
    sheet: SheetView
    days: list[DayTotalView]


@dataclass(frozen=True)
class ReviewPage:
    rows: list[ReviewRow]
    next_page_token: str
    period: PeriodView
    viewer_is_timekeeping_admin: bool


def _active_member_of(organization_id: UUID, user_column) -> object:  # noqa: ANN001
    member = aliased(OrganizationMember)
    person = aliased(User)
    return exists(
        select(1)
        .select_from(member)
        .join(person, person.id == member.user_id)
        .where(
            member.organization_id == organization_id,
            member.user_id == user_column,
            member.is_active.is_(True),
            person.is_active.is_(True),
        )
    )


def _managed_by(organization_id: UUID, actor_id: UUID) -> object:
    return exists(
        select(1)
        .select_from(PeopleProfile)
        .where(
            PeopleProfile.organization_id == organization_id,
            PeopleProfile.user_id == User.id,
            PeopleProfile.manager_user_id == actor_id,
        )
    )


def _led_by(organization_id: UUID, actor_id: UUID) -> object:
    return exists(
        select(1)
        .select_from(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
            Group.lead_user_id == actor_id,
            GroupMember.user_id == User.id,
            GroupMember.is_active.is_(True),
        )
    )


def _has_a_reviewer(organization_id: UUID) -> object:
    """An active manager other than themselves, or an active lead of a TEAM they belong to."""
    manager = exists(
        select(1)
        .select_from(PeopleProfile)
        .where(
            PeopleProfile.organization_id == organization_id,
            PeopleProfile.user_id == User.id,
            PeopleProfile.manager_user_id.is_not(None),
            PeopleProfile.manager_user_id != User.id,
            _active_member_of(organization_id, PeopleProfile.manager_user_id),
        )
    )
    lead = exists(
        select(1)
        .select_from(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
            Group.lead_user_id.is_not(None),
            Group.lead_user_id != User.id,
            GroupMember.user_id == User.id,
            GroupMember.is_active.is_(True),
            _active_member_of(organization_id, Group.lead_user_id),
        )
    )
    return or_(manager, lead)


def _parse_offset(page_token: str) -> int:
    if not page_token:
        return 0
    try:
        offset = int(page_token)
    except ValueError as exc:
        raise ValidationError("page_token", "invalid page token") from exc
    if offset < 0:
        raise ValidationError("page_token", "invalid page token")
    return offset


class TimesheetReview:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)

    async def list_for_reviewer(
        self,
        actor_id: UUID,
        organization_id: UUID,
        day: date,
        *,
        status: TimesheetStatus | None = None,
        page_size: int = DEFAULT_PAGE_SIZE,
        page_token: str = "",
        query: str = "",
        team_id: UUID | None = None,
    ) -> ReviewPage:
        """One query picks the people; three more hydrate the page."""
        await self.access.require_active_actor(actor_id, organization_id)
        is_admin = await self.access.is_timekeeping_admin(actor_id, organization_id)
        policy = await load_time_policy(self.session, organization_id)
        start, end = period_for(day, policy)
        size = min(page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        offset = _parse_offset(page_token)

        scope = or_(_managed_by(organization_id, actor_id), _led_by(organization_id, actor_id))
        if is_admin:
            scope = or_(scope, ~_has_a_reviewer(organization_id))
        sheet_status = func.coalesce(Timesheet.status, TimesheetStatus.OPEN.value)
        people = (
            select(User.id, sheet_status.label("status"))
            .select_from(OrganizationMember)
            .join(User, User.id == OrganizationMember.user_id)
            .outerjoin(
                Timesheet,
                and_(
                    Timesheet.organization_id == organization_id,
                    Timesheet.user_id == User.id,
                    Timesheet.period_start == start,
                ),
            )
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                User.id != actor_id,
                scope,
            )
        )
        if query.strip():
            pattern = f"%{query.strip()}%"
            people = people.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
        if team_id is not None:
            people = people.where(
                exists(
                    select(1)
                    .select_from(GroupMember)
                    .where(
                        GroupMember.group_id == team_id,
                        GroupMember.user_id == User.id,
                        GroupMember.is_active.is_(True),
                    )
                )
            )
        if status is not None:
            people = people.where(sheet_status == status.value)
        people = (
            people
            .order_by(func.coalesce(User.full_name, User.email).asc(), User.id.asc())
            .offset(offset)
            .limit(size + 1)
        )
        found = (await self.session.execute(people)).all()
        user_ids = [row[0] for row in found[:size]]
        next_token = str(offset + size) if len(found) > size else ""

        period = (
            await PeriodOperations(self.session).list(
                actor_id, organization_id, from_date=start, to_date=start
            )
        )[0]
        rows = await self._hydrate(user_ids, organization_id, start, end, period, policy=policy)
        return ReviewPage(
            rows=rows,
            next_page_token=next_token,
            period=period,
            viewer_is_timekeeping_admin=is_admin,
        )

    async def _hydrate(
        self,
        user_ids: list[UUID],
        organization_id: UUID,
        start: date,
        end: date,
        period: PeriodView,
        *,
        policy: ResolvedTimePolicy,
    ) -> list[ReviewRow]:
        if not user_ids:
            return []
        now = datetime.now(UTC)
        sheets_result = await self.session.execute(
            select(Timesheet).where(
                Timesheet.organization_id == organization_id,
                Timesheet.period_start == start,
                Timesheet.user_id.in_(user_ids),
            )
        )
        sheets = {sheet.user_id: sheet for sheet in sheets_result.scalars().all()}
        totals_result = await self.session.execute(
            select(Worklog.user_id, Worklog.work_date, func.sum(Worklog.duration_minutes))
            .where(
                Worklog.organization_id == organization_id,
                Worklog.user_id.in_(user_ids),
                Worklog.is_deleted.is_(False),
                Worklog.work_date >= start,
                Worklog.work_date <= end,
            )
            .group_by(Worklog.user_id, Worklog.work_date)
        )
        minutes: dict[tuple[UUID, date], int] = {
            (user_id, day): int(total) for user_id, day, total in totals_result.all()
        }
        workdays = await workdays_for_users(self.session, user_ids)
        # Rows come back as plain strings; the StrEnum compares equal to its value.
        period_closed = period.status == TimePeriodStatus.CLOSED
        days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
        rows: list[ReviewRow] = []
        for user_id in user_ids:
            sheet = sheets.get(user_id)
            day_totals = [
                DayTotalView(
                    day=day,
                    minutes=minutes.get((user_id, day), 0),
                    required_minutes=required_minutes_on(day, policy, workdays[user_id]),
                )
                for day in days
            ]
            rows.append(
                ReviewRow(
                    sheet=SheetView(
                        timesheet=sheet,
                        user_id=user_id,
                        period_start=start,
                        period_end=end,
                        status=sheet.status if sheet is not None else TimesheetStatus.OPEN,
                        locked=sheet_is_locked(
                            sheet,
                            period_closed=period_closed,
                            period_end=end,
                            policy=policy,
                            now=now,
                        ),
                        period_closed=period_closed,
                        can_review=True,
                        total_minutes=sum(total.minutes for total in day_totals),
                        required_minutes=sum(total.required_minutes for total in day_totals),
                    ),
                    days=day_totals,
                )
            )
        return rows
