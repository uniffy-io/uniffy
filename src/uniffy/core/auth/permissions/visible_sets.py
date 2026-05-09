"""Per-actor materialized visibility sets.

Single-pass replacement for the per-row OR-of-EXISTS predicate that
``domains/tags/visibility/predicate.py`` used to compose. The audit
showed that on a non-admin ``list_tags(page=100)`` the planner could
end up evaluating up to 7 EXISTS branches against ``tag_assignments``
and the content tables for every candidate tag row, which scales
poorly once ``tag_assignments`` grows past ~1B rows.

This module flips the cost shape:

1. Compute the set of tag ids the actor can currently see, once. The
   compute itself is a UNION of seven ``SELECT DISTINCT tag_id``
   queries, each scoped to content the actor can access. The result
   is bounded by the number of tags in the org (~100), not by the
   page size.
2. Cache the set in Valkey for 60s, tagged by org so a permission
   event can wipe every actor's cached visibility for the org in one
   call.
3. The predicate becomes ``Tag.id.in_(visible_ids)`` -- a single
   ``tags_pkey`` membership scan in the outer page query.

The same pattern applies to assignment-row visibility (``list_content``
needs to filter individual rows by the content the actor can see).
``compute_visible_content_ids_by_type`` returns one set per content
type so the assignment predicate can build
``or_(and_(content_type=NOTE, urn_id IN note_ids), ...)``.

Org admins short-circuit: ``compute_visible_tag_ids`` returns ``None``
which the predicate builder treats as "no filter". Domain admins
short-circuit per content type: their entry in the by-type dict is
``None`` and the assignment predicate collapses that branch to a
single content-type test.
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
    """Cache tag covering every visibility entry for an organization."""
    return f"perm_visible_org:{organization_id}"


def _user_tag(user_id: UUID) -> str:
    """Cache tag covering every visibility entry for a single user."""
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
    """Return ``(model, id, owner, access_mode, baseline, org_id)`` columns."""
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
    """Return tag ids the actor can currently see, or ``None`` for org admin.

    A tag is visible when the actor satisfies ANY of:

    - is org OWNER / ADMIN (returns ``None`` -- no filter needed)
    - created the tag (``tags.created_by == user_id``)
    - is domain admin for any content type that has a tag assignment
      (the whole branch passes without an access filter)
    - has at least one tag-assignment pointing at content the actor
      can view under the standard access policy

    The compute is a single UNION of per-content-type
    ``SELECT DISTINCT tag_id`` scans bounded by the actor's accessible
    content -- not by the org's total tag count.
    """
    from uniffy.core.models.tags.tag import Tag, TagAssignment

    checker = PermissionChecker(session)
    if await checker.is_org_admin(user_id, organization_id):
        return None

    domain_admin_types: set[ContentType] = set()
    for ct in _ALL_TAGGABLE_TYPES:
        if await checker.is_domain_admin(user_id, organization_id, ct):
            domain_admin_types.add(ct)

    access_query = ContentAccessQuery(session)
    branches = [
        select(Tag.id.label("tag_id")).where(
            Tag.organization_id == organization_id,
            Tag.created_by == user_id,
        ),
    ]

    for ct in _TAGGABLE_ACCESS_MODE_TYPES:
        if ct in domain_admin_types:
            branches.append(
                select(TagAssignment.tag_id.label("tag_id"))
                .where(TagAssignment.content_type == ct.value)
                .distinct()
            )
            continue
        model, id_col, owner_col, am_col, baseline_col, org_col = _content_columns(ct)
        access_filter = access_query.build_accessible_filter(
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

    branches.append(_task_branch(access_query, user_id, organization_id, domain_admin_types))
    branches.append(_chat_branch(user_id, organization_id, domain_admin_types))

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
    """Return ids of ``content_type`` rows the actor can view.

    Returns ``None`` when the actor short-circuits the filter for this
    content type: org admin, or domain admin for the type. ``None`` is
    the contract for "no filter needed -- any row of this type passes".
    """
    checker = PermissionChecker(session)
    if await checker.is_org_admin(user_id, organization_id):
        return None
    if await checker.is_domain_admin(user_id, organization_id, content_type):
        return None

    if content_type == ContentType.TASK:
        return await _accessible_task_ids(session, user_id, organization_id)
    if content_type == ContentType.CHAT:
        return await _accessible_channel_ids(session, user_id, organization_id)
    if content_type not in _TAGGABLE_ACCESS_MODE_TYPES:
        return set()

    access_query = ContentAccessQuery(session)
    _model, id_col, owner_col, am_col, baseline_col, org_col = _content_columns(content_type)
    access_filter = access_query.build_accessible_filter(
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
    """Cached wrapper around :func:`compute_visible_tag_ids`.

    Caches under ``perm_visible_tags:{org}:{user}`` for 60s, tagged by
    both org and user so a permission event invalidates the right slice
    cheaply. Stampede-protected: a cold miss on a hot user collapses
    onto one loader. Cache returns the union as ``{"all": true}`` for
    org admins or ``{"ids": [...]}`` otherwise.
    """
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
    """Cached wrapper around :func:`compute_visible_content_ids_by_type`."""
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
    """Drop one user's cached visibility for every content type."""
    keys = [_tags_key(organization_id, user_id)]
    keys.extend(
        _content_key(organization_id, user_id, ct) for ct in _ALL_TAGGABLE_TYPES
    )
    await cache_invalidate_many(*keys)


async def invalidate_visible_sets_for_org(organization_id: UUID) -> None:
    """Drop every user's cached visibility for the organization.

    Used on org-wide permission events (access-mode flip on a content
    item, baseline-role change, BLOCKED grants whose affected user set
    isn't enumerable cheaply).
    """
    await cache_invalidate_by_tag(_org_tag(organization_id))


async def invalidate_visible_sets_for_user_global(user_id: UUID) -> None:
    """Drop a single user's cached visibility across every org.

    Used on group-membership changes and other inputs that feed every
    org-scoped role computation for the user.
    """
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
    """Serialize a visibility set for cache storage.

    ``None`` becomes ``{"all": true}`` (admin-shortcut sentinel).
    A set becomes ``{"ids": [str(uuid), ...]}``. The empty-set case is
    preserved as ``{"ids": []}`` so callers can distinguish "nothing
    visible" from "no filter needed".
    """
    if value is None:
        return {"all": True}
    return {"ids": [str(uid) for uid in value]}


def _decode_visibility_payload(payload: dict[str, Any] | None) -> set[UUID] | None:
    """Decode a visibility payload back to a ``set | None``.

    A payload of ``None`` is treated as the admin sentinel because a
    cache miss falling through to the loader will have re-encoded the
    real value; the only way to land here is a Valkey degradation, in
    which case the safest answer is "no filter" (admin-equivalent) so
    the user does not see a hard 404 storm. The caller-side fallback
    in the predicate ultimately re-runs the predicate from scratch
    against PG so there is no stale-allow risk in practice -- but see
    the cache layer's fail-fast contract.
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

    Mirrors the helper in ``domains/tags/visibility/predicate`` but is
    duplicated here to avoid an import cycle (``visibility/predicate``
    imports this module).
    """
    from sqlalchemy import cast, func
    from sqlalchemy.dialects.postgresql import UUID as PGUUID

    from uniffy.core.models.tags.tag import TagAssignment

    return cast(
        func.split_part(TagAssignment.content_urn, ":", 5),
        PGUUID(as_uuid=True),
    )


def _task_branch(
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
    domain_admin_types: set[ContentType],
):
    """Return the union branch yielding tag ids visible via TASK assignments.

    Tasks delegate visibility to their parent project; the branch is a
    JOIN through ``Task -> Project`` with the project access filter.
    Domain admin for projects or tasks collapses the branch to a
    content-type test.
    """
    from uniffy.core.models.projects.project import Project
    from uniffy.core.models.projects.task import Task
    from uniffy.core.models.tags.tag import TagAssignment

    if (
        ContentType.TASK in domain_admin_types
        or ContentType.PROJECT in domain_admin_types
    ):
        return (
            select(TagAssignment.tag_id.label("tag_id"))
            .where(TagAssignment.content_type == ContentType.TASK.value)
            .distinct()
        )

    project_filter = access_query.build_accessible_filter(
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
    domain_admin_types: set[ContentType],
):
    """Return the union branch yielding tag ids visible via CHAT assignments.

    Chat channels do not use the access-mode columns. Visibility is
    PUBLIC channels (open to every org member) plus channels where the
    user has a membership row.
    """
    from sqlalchemy import or_

    from uniffy.core.models.chat.channel import ChannelType, ChatChannel
    from uniffy.core.models.chat.channel_member import ChatChannelMember
    from uniffy.core.models.tags.tag import TagAssignment

    if ContentType.CHAT in domain_admin_types:
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
    """Return task ids visible via their parent project's access policy."""
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
    """Return channel ids visible via PUBLIC type or membership."""
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
