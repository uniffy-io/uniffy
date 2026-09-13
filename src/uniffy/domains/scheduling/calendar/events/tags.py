"""Calendar operations."""

from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, func, select

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.search.indexer import build_content_urn
from uniffy.domains.tags.context import (
    ContentTagMutations,
    ContentTagReader,
    StagedManualTagReplacement,
)

logger = logger.bind(component="scheduling.calendar.events.tags")


class EventTagOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type

    async def stage_copy_tags(
        self,
        *,
        organization_id: UUID,
        actor_id: UUID,
        source_event_id: UUID,
        target_event_id: UUID,
    ) -> StagedManualTagReplacement | None:
        source_urn = build_content_urn(self.content_type, source_event_id)
        target_urn = build_content_urn(self.content_type, target_event_id)
        bulk = await ContentTagReader(self.session).get_for_urns(
            organization_id=organization_id,
            content_urns=[source_urn],
        )
        tag_ids = [tag.id for tag in bulk.get(source_urn, [])]
        if not tag_ids:
            return None
        return await ContentTagMutations(self.session, self.events.search_indexer).stage_manual_tags(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=target_urn,
            tag_ids=tag_ids,
        )

    async def finish_copy_tags(self, staged: StagedManualTagReplacement | None) -> None:
        if staged is None:
            return
        try:
            await ContentTagMutations(
                self.session, self.events.search_indexer
            ).finish_manual_tags_after_commit(staged)
        except Exception:
            logger.opt(exception=True).warning("Copied event tag projection failed")

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Event ids that carry every tag id in `tag_ids` (logical AND)."""
        urn_prefix = "urn:uniffy:content:CALENDAR_EVENT:"
        urn_expr = func.concat(urn_prefix, cast(CalendarEvent.id, String))
        return (
            select(CalendarEvent.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(CalendarEvent.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )
