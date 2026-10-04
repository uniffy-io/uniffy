"""Org-admin oversight of calendars shared beyond their owner: who they reach, never what is on them.

This is an explicit admin browse surface. It reads calendar rows and grant counts only, never
event rows, and its one action can only withdraw organization-wide access.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, exists, false, func, or_, select, true, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, CalendarType, ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.members import ContentMembersOperations

DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500


@dataclass(frozen=True)
class SharedCalendarSummary:
    calendar_id: UUID
    name: str
    owner_id: UUID
    owner_name: str
    calendar_type: CalendarType
    access_mode: AccessMode
    baseline_role: ContentRole | None
    user_grant_count: int
    group_grant_count: int
    created_at: datetime


def _grant_count(subject_type: SubjectType):
    return (
        select(func.count())
        .where(
            ContentMember.organization_id == Calendar.organization_id,
            ContentMember.content_type == ContentType.CALENDAR,
            ContentMember.content_id == Calendar.id,
            ContentMember.subject_type == subject_type,
            ContentMember.role != ContentRole.BLOCKED,
            or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > datetime.now(UTC)),
        )
        .correlate(Calendar)
        .scalar_subquery()
    )


class SharedCalendarInventory:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_shared(
        self,
        actor_id: UUID,
        organization_id: UUID,
        *,
        page_size: int = DEFAULT_PAGE_SIZE,
        page_token: str = "",
    ) -> tuple[list[SharedCalendarSummary], str]:
        await self._require_org_admin(actor_id, organization_id)
        size = min(max(page_size or DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
        default_mode, default_baseline = await resolve_content_defaults(
            self.session, organization_id, ContentType.CALENDAR
        )
        inherits_open = true() if default_mode == AccessMode.OPEN_TO_ORG else false()
        # A calendar set to named members but naming nobody reaches only its owner.
        has_grants = exists().where(
            ContentMember.organization_id == Calendar.organization_id,
            ContentMember.content_type == ContentType.CALENDAR,
            ContentMember.content_id == Calendar.id,
            ContentMember.role != ContentRole.BLOCKED,
            or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > datetime.now(UTC)),
        )
        query = (
            select(
                Calendar,
                func.coalesce(User.full_name, User.email),
                _grant_count(SubjectType.USER),
                _grant_count(SubjectType.GROUP),
            )
            .join(User, User.id == Calendar.owner_id)
            .where(
                Calendar.organization_id == organization_id,
                Calendar.is_deleted == False,  # noqa: E712
                or_(
                    Calendar.access_mode == AccessMode.OPEN_TO_ORG,
                    and_(Calendar.access_mode.is_(None), inherits_open),
                    has_grants,
                ),
            )
        )
        if page_token:
            moment, last_id = decode_time_cursor(page_token)
            query = query.where(tuple_(Calendar.created_at, Calendar.id) < tuple_(moment, last_id))
        rows = (
            await self.session.execute(
                query.order_by(Calendar.created_at.desc(), Calendar.id.desc()).limit(size + 1)
            )
        ).all()
        summaries = [
            _summary(calendar, owner_name, users, groups, default_mode, default_baseline)
            for calendar, owner_name, users, groups in rows[:size]
        ]
        if len(rows) <= size:
            return summaries, ""
        last = rows[size - 1][0]
        return summaries, encode_time_cursor(last.created_at, last.id)

    async def restrict_to_members(
        self,
        actor_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        search_indexer: SearchIndexer,
    ) -> SharedCalendarSummary:
        members = ContentMembersOperations(self.session, search_indexer)
        staged = await members.stage_admin_restriction(
            actor_id, organization_id, ContentType.CALENDAR, calendar_id
        )
        await self.session.commit()
        await members.finish_access_mode_after_commit(staged)
        return await self._summary_for(organization_id, calendar_id)

    async def _summary_for(self, organization_id: UUID, calendar_id: UUID) -> SharedCalendarSummary:
        default_mode, default_baseline = await resolve_content_defaults(
            self.session, organization_id, ContentType.CALENDAR
        )
        row = (
            await self.session.execute(
                select(
                    Calendar,
                    func.coalesce(User.full_name, User.email),
                    _grant_count(SubjectType.USER),
                    _grant_count(SubjectType.GROUP),
                )
                .join(User, User.id == Calendar.owner_id)
                .where(Calendar.id == calendar_id, Calendar.organization_id == organization_id)
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError("Calendar", calendar_id)
        calendar, owner_name, users, groups = row
        return _summary(calendar, owner_name, users, groups, default_mode, default_baseline)

    async def _require_org_admin(self, actor_id: UUID, organization_id: UUID) -> None:
        if not await PermissionChecker(self.session).is_org_admin(actor_id, organization_id):
            raise PermissionDeniedError("view", "shared calendars")


def _summary(
    calendar: Calendar,
    owner_name: str | None,
    user_grants: int,
    group_grants: int,
    default_mode: AccessMode,
    default_baseline: ContentRole | None,
) -> SharedCalendarSummary:
    mode, baseline = resolve_effective_policy(
        calendar.access_mode, calendar.baseline_role, default_mode, default_baseline
    )
    return SharedCalendarSummary(
        calendar_id=calendar.id,
        name=calendar.name,
        owner_id=calendar.owner_id,
        owner_name=owner_name or "",
        calendar_type=calendar.calendar_type,
        access_mode=mode,
        baseline_role=baseline if mode == AccessMode.OPEN_TO_ORG else None,
        user_grant_count=int(user_grants or 0),
        group_grant_count=int(group_grants or 0),
        created_at=calendar.created_at,
    )
