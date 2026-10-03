"""PostgreSQL visibility sets for tags and taggable content."""

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.types import ContentType

_TAGGABLE_ACCESS_MODE_TYPES: tuple[ContentType, ...] = (
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.FOLDER,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.AGENT,
    ContentType.ROOM,
)


def _content_columns(content_type: ContentType) -> tuple:
    """``(model, id, owner, access_mode, baseline, org_id)`` columns for ``content_type``."""
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        return (
            Note,
            Note.id,
            Note.owner_id,
            Note.access_mode,
            Note.baseline_role,
            Note.organization_id,
        )
    if content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File

        return (
            File,
            File.id,
            File.owner_id,
            File.access_mode,
            File.baseline_role,
            File.organization_id,
        )
    if content_type == ContentType.FOLDER:
        from uniffy.core.models.files.folder import Folder

        return (
            Folder,
            Folder.id,
            Folder.owner_id,
            Folder.access_mode,
            Folder.baseline_role,
            Folder.organization_id,
        )
    if content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        return (
            CalendarEvent,
            CalendarEvent.id,
            CalendarEvent.owner_id,
            CalendarEvent.access_mode,
            CalendarEvent.baseline_role,
            CalendarEvent.organization_id,
        )
    if content_type == ContentType.PROJECT:
        from uniffy.core.models.projects.project import Project

        return (
            Project,
            Project.id,
            Project.owner_id,
            Project.access_mode,
            Project.baseline_role,
            Project.organization_id,
        )
    if content_type == ContentType.AGENT:
        from uniffy.core.models.agents.agent import Agent

        return (
            Agent,
            Agent.id,
            Agent.owner_id,
            Agent.access_mode,
            Agent.baseline_role,
            Agent.organization_id,
        )
    if content_type == ContentType.ROOM:
        from uniffy.core.models.rooms.room import Room

        return (
            Room,
            Room.id,
            Room.owner_id,
            Room.access_mode,
            Room.baseline_role,
            Room.organization_id,
        )
    raise ValueError(f"unsupported access-mode content type {content_type!r}")


async def compute_visible_tag_ids(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    candidate_tag_ids: Collection[UUID] | None = None,
) -> set[UUID]:
    """Tag ids the actor can see.

    Visible = created the tag, or has an assignment pointing at content the
    actor can view under the standard access policy. Chat assignments are
    visible for the actor's channels (plus PUBLIC), or every channel when the
    actor moderates chat (org admin / chat domain admin).
    """
    from uniffy.core.models.tags.tag import Tag, TagAssignment

    candidate_ids = set(candidate_tag_ids or ())
    if candidate_tag_ids is not None and not candidate_ids:
        return set()

    access_query = ContentAccessQuery(session)
    active_member = await access_query.is_active_member(user_id, organization_id)
    if not active_member and not await access_query.has_support_access(user_id, organization_id):
        return set()

    checker = PermissionChecker(session)
    chat_moderator = active_member and (
        await checker.is_org_admin(user_id, organization_id)
        or await checker.is_domain_admin(user_id, organization_id, ContentType.CHAT)
    )

    creator_predicates = [
        Tag.organization_id == organization_id,
        Tag.created_by == user_id,
    ]
    assignment_predicates = []
    if candidate_tag_ids is not None:
        creator_predicates.append(Tag.id.in_(candidate_ids))
        assignment_predicates.append(TagAssignment.tag_id.in_(candidate_ids))
    branches = [select(Tag.id.label("tag_id")).where(*creator_predicates)]

    for ct in _TAGGABLE_ACCESS_MODE_TYPES:
        model, id_col, _owner_col, _am_col, _baseline_col, org_col = _content_columns(ct)
        access_filter = await _type_access_filter(access_query, user_id, organization_id, ct)
        branches.append(
            select(TagAssignment.tag_id.label("tag_id"))
            .join(model, id_col == _content_id_from_urn_expr())
            .where(
                TagAssignment.content_type == ct.value,
                *assignment_predicates,
                org_col == organization_id,
                access_filter,
            )
            .distinct()
        )

    branches.append(
        await _task_branch(
            access_query,
            user_id,
            organization_id,
            candidate_ids if candidate_tag_ids is not None else None,
        )
    )
    if active_member:
        branches.append(
            _chat_branch(
                user_id,
                organization_id,
                chat_moderator,
                candidate_ids if candidate_tag_ids is not None else None,
            )
        )

    union_q = union_all(*branches).subquery()
    rows = (await session.execute(select(union_q.c.tag_id).distinct())).scalars().all()
    return {row for row in rows if row is not None}


async def compute_visible_content_ids_by_type(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
) -> set[UUID] | None:
    """Ids of ``content_type`` rows the actor can view; ``None`` for "no filter needed"."""
    checker = PermissionChecker(session)

    if content_type == ContentType.CHAT:
        access_query = ContentAccessQuery(session)
        if not await access_query.is_active_member(user_id, organization_id):
            return set()
        # Chat moderation is retained: org admins and chat domain admins see
        # every channel. Everyone else gets PUBLIC channels plus memberships.
        if await checker.is_org_admin(user_id, organization_id) or await checker.is_domain_admin(
            user_id, organization_id, ContentType.CHAT
        ):
            return None
        return await _accessible_channel_ids(session, user_id, organization_id)

    if content_type == ContentType.TASK:
        return await _accessible_task_ids(session, user_id, organization_id)
    if content_type not in _TAGGABLE_ACCESS_MODE_TYPES:
        return set()

    access_query = ContentAccessQuery(session)
    _model, id_col, _owner_col, _am_col, _baseline_col, org_col = _content_columns(content_type)
    access_filter = await _type_access_filter(access_query, user_id, organization_id, content_type)
    rows = (
        (await session.execute(select(id_col).where(org_col == organization_id, access_filter)))
        .scalars()
        .all()
    )
    return {row for row in rows if row is not None}


async def _event_extra_access(
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
):
    """Events are also readable through their calendar and through an invitation.

    Mirrors the calendar domain's event filter, which core cannot import; an
    explicit BLOCKED on the series beats both lifts, edited occurrences included.
    """
    from sqlalchemy import and_, func, or_

    from uniffy.core.models.calendar.attendee import EventAttendee
    from uniffy.core.models.calendar.calendar import Calendar
    from uniffy.core.models.calendar.event import CalendarEvent

    calendar_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.CALENDAR,
        content_id_column=Calendar.id,
        owner_id_column=Calendar.owner_id,
        access_mode_column=Calendar.access_mode,
        baseline_role_column=Calendar.baseline_role,
    )
    readable_calendars = select(Calendar.id).where(
        Calendar.organization_id == organization_id,
        Calendar.is_deleted == False,  # noqa: E712
        calendar_filter,
    )
    invited = select(EventAttendee.event_id).where(EventAttendee.user_id == user_id)
    return and_(
        or_(
            CalendarEvent.calendar_id.in_(readable_calendars),
            CalendarEvent.id.in_(invited),
        ),
        access_query.build_not_blocked_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id_column=func.coalesce(CalendarEvent.recurrence_id, CalendarEvent.id),
        ),
    )


async def _type_access_filter(
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
):
    from sqlalchemy import or_

    _model, id_col, owner_col, am_col, baseline_col, _org_col = _content_columns(content_type)
    access_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id_column=id_col,
        owner_id_column=owner_col,
        access_mode_column=am_col,
        baseline_role_column=baseline_col,
    )
    if content_type != ContentType.CALENDAR_EVENT:
        return access_filter
    if not await access_query.is_active_member(user_id, organization_id):
        return access_filter
    return or_(access_filter, await _event_extra_access(access_query, user_id, organization_id))


def _content_id_from_urn_expr():
    """Cast the trailing UUID segment of ``content_urn`` to ``uuid``.

    Duplicated from ``domains/tags/visibility/predicate`` to avoid an import
    cycle (that module imports this one).
    """
    from sqlalchemy import cast, func
    from sqlalchemy.dialects.postgresql import UUID as PGUUID

    from uniffy.core.models.tags.tag import TagAssignment

    return cast(
        func.split_part(TagAssignment.content_urn, ":", 5),
        PGUUID(as_uuid=True),
    )


async def _task_branch(
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
    candidate_tag_ids: set[UUID] | None = None,
):
    """Tag ids visible via TASK assignments (delegate to parent project access)."""
    from uniffy.core.models.projects.project import Project
    from uniffy.core.models.projects.task import Task
    from uniffy.core.models.tags.tag import TagAssignment

    project_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.PROJECT,
        content_id_column=Project.id,
        owner_id_column=Project.owner_id,
        access_mode_column=Project.access_mode,
        baseline_role_column=Project.baseline_role,
    )
    predicates = [
        TagAssignment.content_type == ContentType.TASK.value,
        Task.organization_id == organization_id,
        Project.organization_id == organization_id,
        project_filter,
    ]
    if candidate_tag_ids is not None:
        predicates.append(TagAssignment.tag_id.in_(candidate_tag_ids))
    return (
        select(TagAssignment.tag_id.label("tag_id"))
        .join(Task, Task.id == _content_id_from_urn_expr())
        .join(Project, Project.id == Task.project_id)
        .where(*predicates)
        .distinct()
    )


def _chat_branch(
    user_id: UUID,
    organization_id: UUID,
    chat_moderator: bool,
    candidate_tag_ids: set[UUID] | None = None,
):
    """Tag ids visible via CHAT assignments: PUBLIC channels plus the user's
    memberships, or every channel when the actor moderates chat."""
    from sqlalchemy import or_

    from uniffy.core.models.chat.channel import ChannelType, ChatChannel
    from uniffy.core.models.chat.channel_member import ChatChannelMember
    from uniffy.core.models.tags.tag import TagAssignment

    predicates = [TagAssignment.content_type == ContentType.CHAT.value]
    if candidate_tag_ids is not None:
        predicates.append(TagAssignment.tag_id.in_(candidate_tag_ids))
    if chat_moderator:
        return (
            select(TagAssignment.tag_id.label("tag_id"))
            .join(ChatChannel, ChatChannel.id == _content_id_from_urn_expr())
            .where(
                *predicates,
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .distinct()
        )

    member_subq = select(ChatChannelMember.channel_id).where(
        ChatChannelMember.user_id == user_id,
    )
    return (
        select(TagAssignment.tag_id.label("tag_id"))
        .join(ChatChannel, ChatChannel.id == _content_id_from_urn_expr())
        .where(
            *predicates,
            ChatChannel.organization_id == organization_id,
            ChatChannel.is_deleted == False,  # noqa: E712
            or_(
                ChatChannel.channel_type == ChannelType.PUBLIC,
                ChatChannel.id.in_(member_subq),
            ),
        )
        .distinct()
    )


async def _accessible_task_ids(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> set[UUID]:
    """Task ids visible via the parent project's access policy."""
    from uniffy.core.models.projects.task import Task

    project_ids = await compute_visible_content_ids_by_type(
        session,
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.PROJECT,
    )
    if project_ids is None:
        rows = (
            (await session.execute(select(Task.id).where(Task.organization_id == organization_id)))
            .scalars()
            .all()
        )
        return {row for row in rows if row is not None}
    if not project_ids:
        return set()
    rows = (
        (
            await session.execute(
                select(Task.id).where(
                    Task.organization_id == organization_id,
                    Task.project_id.in_(project_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    return {row for row in rows if row is not None}


async def _accessible_channel_ids(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> set[UUID]:
    """Channel ids visible via PUBLIC type or membership."""
    from sqlalchemy import or_

    from uniffy.core.models.chat.channel import ChannelType, ChatChannel
    from uniffy.core.models.chat.channel_member import ChatChannelMember

    member_subq = select(ChatChannelMember.channel_id).where(
        ChatChannelMember.user_id == user_id,
    )
    rows = (
        (
            await session.execute(
                select(ChatChannel.id).where(
                    ChatChannel.organization_id == organization_id,
                    ChatChannel.is_deleted == False,  # noqa: E712
                    or_(
                        ChatChannel.channel_type == ChannelType.PUBLIC,
                        ChatChannel.id.in_(member_subq),
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    return {row for row in rows if row is not None}
