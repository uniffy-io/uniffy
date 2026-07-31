"""Per-actor materialised visibility sets for tags / taggable content.

The tag predicate becomes ``Tag.id.in_(visible_ids)`` against a Valkey-cached
union of ``SELECT DISTINCT tag_id`` branches scoped to content the actor can
access. Org/domain admins get no content bypass here - they are filtered like
any member. The one exception is chat: org admins and chat domain admins keep
the chat moderation view (all channels), since chat access lives in
``ChatAccessChecker`` rather than the access-mode model.

The same set per content type drives ``list_content`` row filtering via
``compute_visible_content_ids_by_type``.
"""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.types import ContentType
from uniffy.core.valkey.cache import (
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
    cache_invalidate_many,
)

VISIBLE_TAGS_TTL = 60
VISIBLE_CONTENT_TTL = 60

_TAGS_KEY_PREFIX = "perm_visible_tags"
_CONTENT_KEY_PREFIX = "perm_visible_content"

_TAGGABLE_ACCESS_MODE_TYPES: tuple[ContentType, ...] = (
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.AGENT,
)

_ALL_TAGGABLE_TYPES: tuple[ContentType, ...] = (
    *_TAGGABLE_ACCESS_MODE_TYPES,
    ContentType.TASK,
    ContentType.CHAT,
)


def _org_tag(organization_id: UUID) -> str:
    return f"perm_visible_org:{organization_id}"


def _user_tag(user_id: UUID) -> str:
    return f"perm_visible_user:{user_id}"


def _tags_key(organization_id: UUID, user_id: UUID) -> str:
    return f"{_TAGS_KEY_PREFIX}:{organization_id}:{user_id}"


def _content_key(
    organization_id: UUID,
    user_id: UUID,
    content_type: ContentType,
) -> str:
    return (
        f"{_CONTENT_KEY_PREFIX}:{organization_id}:{user_id}:{content_type.value}"
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
    raise ValueError(f"unsupported access-mode content type {content_type!r}")


async def compute_visible_tag_ids(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> set[UUID] | None:
    """Tag ids the actor can see.

    Visible = created the tag, or has an assignment pointing at content the
    actor can view under the standard access policy. Chat assignments are
    visible for the actor's channels (plus PUBLIC), or every channel when the
    actor moderates chat (org admin / chat domain admin).
    """
    from uniffy.core.models.tags.tag import Tag, TagAssignment

    checker = PermissionChecker(session)
    chat_moderator = await checker.is_org_admin(
        user_id, organization_id
    ) or await checker.is_domain_admin(user_id, organization_id, ContentType.CHAT)

    access_query = ContentAccessQuery(session)
    branches = [
        select(Tag.id.label("tag_id")).where(
            Tag.organization_id == organization_id,
            Tag.created_by == user_id,
        ),
    ]

    for ct in _TAGGABLE_ACCESS_MODE_TYPES:
        model, id_col, owner_col, am_col, baseline_col, org_col = _content_columns(ct)
        access_filter = await access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ct,
            content_id_column=id_col,
            owner_id_column=owner_col,
            access_mode_column=am_col,
            baseline_role_column=baseline_col,
        )
        branches.append(
            select(TagAssignment.tag_id.label("tag_id"))
            .join(model, id_col == _content_id_from_urn_expr())
            .where(
                TagAssignment.content_type == ct.value,
                org_col == organization_id,
                access_filter,
            )
            .distinct()
        )

    branches.append(await _task_branch(access_query, user_id, organization_id))
    branches.append(_chat_branch(user_id, organization_id, chat_moderator))

    union_q = union_all(*branches).subquery()
    rows = (
        await session.execute(select(union_q.c.tag_id).distinct())
    ).scalars().all()
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
        # Chat moderation is retained: org admins and chat domain admins see
        # every channel. Everyone else gets PUBLIC channels plus memberships.
        if await checker.is_org_admin(
            user_id, organization_id
        ) or await checker.is_domain_admin(
            user_id, organization_id, ContentType.CHAT
        ):
            return None
        return await _accessible_channel_ids(session, user_id, organization_id)

    if content_type == ContentType.TASK:
        return await _accessible_task_ids(session, user_id, organization_id)
    if content_type not in _TAGGABLE_ACCESS_MODE_TYPES:
        return set()

    access_query = ContentAccessQuery(session)
    _model, id_col, owner_col, am_col, baseline_col, org_col = _content_columns(content_type)
    access_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id_column=id_col,
        owner_id_column=owner_col,
        access_mode_column=am_col,
        baseline_role_column=baseline_col,
    )
    rows = (
        await session.execute(
            select(id_col).where(org_col == organization_id, access_filter)
        )
    ).scalars().all()
    return {row for row in rows if row is not None}


async def get_visible_tag_ids(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> set[UUID] | None:
    """Cached + stampede-protected wrapper around :func:`compute_visible_tag_ids`."""
    payload = await cache_get_or_set_locked(
        _tags_key(organization_id, user_id),
        _make_tags_loader(session, user_id, organization_id),
        ttl=VISIBLE_TAGS_TTL,
        tags=[_org_tag(organization_id), _user_tag(user_id)],
    )
    return _decode_visibility_payload(payload)


async def get_visible_content_ids_by_type(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
) -> set[UUID] | None:
    payload = await cache_get_or_set_locked(
        _content_key(organization_id, user_id, content_type),
        _make_content_loader(session, user_id, organization_id, content_type),
        ttl=VISIBLE_CONTENT_TTL,
        tags=[_org_tag(organization_id), _user_tag(user_id)],
    )
    return _decode_visibility_payload(payload)


async def invalidate_visible_sets_for_user(
    organization_id: UUID,
    user_id: UUID,
) -> None:
    keys = [_tags_key(organization_id, user_id)]
    keys.extend(
        _content_key(organization_id, user_id, ct) for ct in _ALL_TAGGABLE_TYPES
    )
    await cache_invalidate_many(*keys)


async def invalidate_visible_sets_for_org(organization_id: UUID) -> None:
    """Drop every user's cached visibility for the org (access-mode / BLOCKED events)."""
    await cache_invalidate_by_tag(_org_tag(organization_id))


async def invalidate_visible_sets_for_user_global(user_id: UUID) -> None:
    """Drop a user's cached visibility across every org (group-membership changes)."""
    await cache_invalidate_by_tag(_user_tag(user_id))


def _make_tags_loader(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> Callable[[], Awaitable[dict[str, Any] | None]]:
    async def _load() -> dict[str, Any] | None:
        result = await compute_visible_tag_ids(
            session, user_id=user_id, organization_id=organization_id
        )
        return _encode_visibility_payload(result)

    return _load


def _make_content_loader(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
) -> Callable[[], Awaitable[dict[str, Any] | None]]:
    async def _load() -> dict[str, Any] | None:
        result = await compute_visible_content_ids_by_type(
            session,
            user_id=user_id,
            organization_id=organization_id,
            content_type=content_type,
        )
        return _encode_visibility_payload(result)

    return _load


def _encode_visibility_payload(value: set[UUID] | None) -> dict[str, Any]:
    """``None`` (admin) -> ``{"all": true}``; set -> ``{"ids": [...]}`` (empty preserved)."""
    if value is None:
        return {"all": True}
    return {"ids": [str(uid) for uid in value]}


def _decode_visibility_payload(payload: dict[str, Any] | None) -> set[UUID] | None:
    """``None`` payload (Valkey degraded) is treated as the admin sentinel.

    The predicate falls back to a fresh PG compute, so this fail-open path does
    not produce stale-allow in practice.
    """
    if payload is None:
        return None
    if payload.get("all") is True:
        return None
    raw_ids = payload.get("ids", [])
    if not raw_ids:
        return set()
    return {UUID(value) for value in raw_ids}


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
    return (
        select(TagAssignment.tag_id.label("tag_id"))
        .join(Task, Task.id == _content_id_from_urn_expr())
        .join(Project, Project.id == Task.project_id)
        .where(
            TagAssignment.content_type == ContentType.TASK.value,
            Task.organization_id == organization_id,
            Project.organization_id == organization_id,
            project_filter,
        )
        .distinct()
    )


def _chat_branch(
    user_id: UUID,
    organization_id: UUID,
    chat_moderator: bool,
):
    """Tag ids visible via CHAT assignments: PUBLIC channels plus the user's
    memberships, or every channel when the actor moderates chat."""
    from sqlalchemy import or_

    from uniffy.core.models.chat.channel import ChannelType, ChatChannel
    from uniffy.core.models.chat.channel_member import ChatChannelMember
    from uniffy.core.models.tags.tag import TagAssignment

    if chat_moderator:
        return (
            select(TagAssignment.tag_id.label("tag_id"))
            .where(TagAssignment.content_type == ContentType.CHAT.value)
            .distinct()
        )

    member_subq = select(ChatChannelMember.channel_id).where(
        ChatChannelMember.user_id == user_id,
    )
    return (
        select(TagAssignment.tag_id.label("tag_id"))
        .join(ChatChannel, ChatChannel.id == _content_id_from_urn_expr())
        .where(
            TagAssignment.content_type == ContentType.CHAT.value,
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
            await session.execute(
                select(Task.id).where(Task.organization_id == organization_id)
            )
        ).scalars().all()
        return {row for row in rows if row is not None}
    if not project_ids:
        return set()
    rows = (
        await session.execute(
            select(Task.id).where(
                Task.organization_id == organization_id,
                Task.project_id.in_(project_ids),
            )
        )
    ).scalars().all()
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
    ).scalars().all()
    return {row for row in rows if row is not None}
