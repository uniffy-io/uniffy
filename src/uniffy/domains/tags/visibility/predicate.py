"""Tag and assignment visibility predicates.

Both predicates resolve to a SQL boolean expression suitable for
inlining as ``WHERE await build_*_predicate(...)`` on a tag-shaped or
assignment-shaped query.

Implementation strategy
-----------------------
Each call goes through ``core.auth.permissions.visible_sets`` to fetch
(and cache) the materialized set of ids the actor can currently see:

- :func:`build_tag_visibility_predicate` returns ``Tag.id.in_(visible)``
  where ``visible`` is the union of self-created tags plus tag ids
  reachable through any visible content. The outer page query becomes
  a single ``tags_pkey`` membership scan instead of seven OR'd EXISTS
  branches.
- :func:`build_assignment_visibility_predicate` returns an OR over
  per-content-type membership tests:
  ``or_(and_(content_type='NOTE', urn_id IN (note_ids)), ...)``.

Org admins short-circuit -- the visible-set helper returns ``None``
and the builder returns ``None`` so the caller skips the WHERE clause
entirely. Domain admins short-circuit per content type for assignment
visibility (their entry is ``None`` and that branch collapses to a
content-type test with no membership filter).

The visible-set cache lives at ``perm_visible_tags:{org}:{user}`` and
``perm_visible_content:{org}:{user}:{type}`` for 60s, tagged by org so
permission events invalidate every actor's cache cheaply.
"""

from uuid import UUID

from sqlalchemy import ColumnElement, and_, cast, false, func, or_
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.visible_sets import (
    get_visible_content_ids_by_type,
    get_visible_tag_ids,
)
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import ContentType

_ASSIGNMENT_CONTENT_TYPES: tuple[ContentType, ...] = (
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.AGENT,
    ContentType.TASK,
    ContentType.CHAT,
)


def _content_id_from_urn() -> ColumnElement:
    """Cast the trailing UUID segment of ``content_urn`` to ``uuid``.

    ``urn:uniffy:content:TYPE:{uuid}`` -- ``split_part(..., ':', 5)``
    grabs the last segment, then we cast to PG ``uuid``.
    """
    return cast(
        func.split_part(TagAssignment.content_urn, ":", 5),
        PGUUID(as_uuid=True),
    )


async def build_tag_visibility_predicate(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> ColumnElement[bool] | None:
    """Return a WHERE expression gating ``Tag`` rows by viewer access.

    Returns ``None`` for org admins so the caller applies no extra
    filter. Returns a literal ``FALSE`` when the actor has no visible
    tags so the page query short-circuits without scanning. Otherwise
    returns ``Tag.id.in_(visible_ids)``.
    """
    visible = await get_visible_tag_ids(
        session, user_id=user_id, organization_id=organization_id
    )
    if visible is None:
        return None
    if not visible:
        return false()
    return Tag.id.in_(visible)


async def build_assignment_visibility_predicate(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> ColumnElement[bool] | None:
    """Per-row WHERE expression for ``tag_assignments`` queries.

    Returns ``None`` for org admins. Otherwise returns an OR'd
    expression with one branch per content type. Each branch tests
    ``content_type = '<TYPE>'`` AND, unless the actor is a domain admin
    for that type, ``urn_id IN (visible_ids_of_type)``.
    """
    branches: list[ColumnElement[bool]] = []
    unfiltered_types = 0

    for ct in _ASSIGNMENT_CONTENT_TYPES:
        visible_ids = await get_visible_content_ids_by_type(
            session,
            user_id=user_id,
            organization_id=organization_id,
            content_type=ct,
        )
        if visible_ids is None:
            unfiltered_types += 1
            branches.append(TagAssignment.content_type == ct.value)
            continue
        if not visible_ids:
            continue
        branches.append(
            and_(
                TagAssignment.content_type == ct.value,
                _content_id_from_urn().in_(visible_ids),
            )
        )

    if unfiltered_types == len(_ASSIGNMENT_CONTENT_TYPES):
        return None

    if not branches:
        return false()

    return or_(*branches)
