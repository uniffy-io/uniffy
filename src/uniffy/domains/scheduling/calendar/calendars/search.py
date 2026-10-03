"""Search access that events inherit from the calendar they sit on."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import Select, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.jobs import enqueue_job
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.search_acl_refresh import CalendarSearchAclRefresh
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.search.policy import SearchContainerAccess, build_document_id
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.scheduling.calendar.jobs.contracts import REFRESH_CALENDAR_SEARCH_ACL

logger = logger.bind(component="scheduling.calendar.calendars.search")


async def calendar_search_access(
    session: AsyncSession,
    organization_id: UUID,
    calendar_id: UUID,
) -> SearchContainerAccess:
    """The calendar's owner and non-blocked members; a deleted calendar grants nothing.

    A member blocked on the calendar but reached through a group or the org
    stays a candidate here; the resolver drops the hit.
    """
    calendar = (
        await session.execute(
            select(Calendar).where(
                Calendar.id == calendar_id,
                Calendar.organization_id == organization_id,
                Calendar.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if calendar is None:
        return SearchContainerAccess()

    now = datetime.now(UTC)
    member_rows = (
        await session.execute(
            select(ContentMember.subject_type, ContentMember.subject_id).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == ContentType.CALENDAR,
                ContentMember.content_id == calendar_id,
                ContentMember.role != ContentRole.BLOCKED,
                or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now),
            )
        )
    ).all()
    user_ids = [calendar.owner_id]
    group_ids: list[UUID] = []
    for subject_type, subject_id in member_rows:
        if subject_type == SubjectType.USER:
            user_ids.append(subject_id)
        elif subject_type == SubjectType.GROUP:
            group_ids.append(subject_id)

    default_mode, default_baseline = await resolve_content_defaults(
        session, organization_id, ContentType.CALENDAR
    )
    mode, baseline = resolve_effective_policy(
        calendar.access_mode, calendar.baseline_role, default_mode, default_baseline
    )
    return SearchContainerAccess(
        user_ids=tuple(dict.fromkeys(user_ids)),
        group_ids=tuple(dict.fromkeys(group_ids)),
        open_to_org=mode == AccessMode.OPEN_TO_ORG and baseline is not None,
    )


def calendar_event_ids(
    organization_id: UUID,
    calendar_id: UUID,
    *,
    after: UUID | None,
    limit: int,
) -> Select:
    """A keyset page of live event rows whose access resolves through ``calendar_id``.

    Edited occurrences always share their series' calendar (a series moves as a
    whole), so the calendar column alone finds them and the index serves the order.
    """
    query = (
        select(CalendarEvent.id)
        .where(
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.calendar_id == calendar_id,
            CalendarEvent.is_deleted == False,  # noqa: E712
        )
        .order_by(CalendarEvent.id)
        .limit(limit)
    )
    if after is not None:
        query = query.where(CalendarEvent.id > after)
    return query


def event_document_ids(organization_id: UUID, event_ids: list[UUID]) -> list[str]:
    return [
        build_document_id(build_content_urn(ContentType.CALENDAR_EVENT, event_id), organization_id)
        for event_id in event_ids
    ]


async def refresh_series_container_access(
    session: AsyncSession,
    search_indexer: SearchIndexer,
    organization_id: UUID,
    master: CalendarEvent,
) -> None:
    """Re-point a moved series' edited occurrences at the calendar it now sits on."""
    override_ids = list(
        (
            await session.execute(
                select(CalendarEvent.id).where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.recurrence_id == master.id,
                    CalendarEvent.is_deleted == False,  # noqa: E712
                )
            )
        ).scalars()
    )
    if not override_ids:
        return
    access = await calendar_search_access(session, organization_id, master.calendar_id)
    await search_indexer.update_container_access(
        event_document_ids(organization_id, override_ids), access
    )


async def record_calendar_search_acl_refresh(
    session: AsyncSession,
    organization_id: UUID,
    calendar_id: UUID,
) -> None:
    stmt = (
        pg_insert(CalendarSearchAclRefresh)
        .values(
            calendar_id=calendar_id,
            organization_id=organization_id,
            version=1,
            attempts=0,
            created_at=datetime.now(UTC),
        )
        .on_conflict_do_update(
            index_elements=["calendar_id"],
            set_={
                "organization_id": organization_id,
                "version": CalendarSearchAclRefresh.version + 1,
                "attempts": 0,
                "created_at": datetime.now(UTC),
            },
        )
    )
    await session.execute(stmt)


async def enqueue_calendar_search_acl_refresh(calendar_id: UUID) -> None:
    try:
        await enqueue_job(REFRESH_CALENDAR_SEARCH_ACL, str(calendar_id))
    except RuntimeError:
        logger.warning(f"Search ACL refresh queued in DB only for calendar {calendar_id}")
    except Exception:
        logger.opt(exception=True).warning(
            f"Failed to enqueue search ACL refresh for calendar {calendar_id}"
        )
