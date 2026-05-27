"""Tag/assignment visibility predicates; visible-set helpers cache results
so org admins short-circuit to ``None``.
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
    """Cast the trailing UUID segment of ``urn:uniffy:content:TYPE:{uuid}`` to PG ``uuid``."""
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
    """Returns ``None`` for org admins, ``FALSE`` for none-visible, else
    ``Tag.id.in_(visible_ids)``.
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
    """OR'd per-content-type branches; domain admins for a type drop the
    membership filter for that branch.
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
