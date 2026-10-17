from typing import Any
from uuid import UUID

from loguru import logger
from uniffy_proto.notifications.v1.notifications_pb import ContentChangedPayload

from uniffy.core.auth.permissions.batching import FreshAudience
from uniffy.core.converters.common_proto import CONTENT_TYPE_FROM_PROTO
from uniffy.core.database import SessionFactory
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import (
    ResourceAudienceResolver,
    ResourceKey,
)

logger = logger.bind(component="notifications.content")


async def _resolve_audience(
    scope: tuple[SessionFactory, UUID, ResourceKey],
    actors: list[UUID],
) -> dict[UUID, bool]:
    session_factory, organization_id, key = scope
    async with session_factory() as session:
        allowed = set(
            await ResourceAudienceResolver(session).filter_resource(
                organization_id=organization_id,
                key=key,
                candidate_user_ids=actors,
            )
        )
    return {actor: actor in allowed for actor in actors}


_audience = FreshAudience(_resolve_audience)


async def project_content_change(
    payload: dict[str, Any],
    user_id: UUID,
    organization_id: UUID,
    session_factory: SessionFactory,
) -> ContentChangedPayload | None:
    try:
        content_type = CONTENT_TYPE_FROM_PROTO.get(payload.get("content_type"))
        if content_type not in {ContentType.TASK, ContentType.CALENDAR_EVENT}:
            return None
        content_id = UUID(payload["content_id"])
        key = ResourceKey(content_type, content_id)
        if not await _audience.check((session_factory, organization_id, key), user_id):
            return None
        return ContentChangedPayload(
            content_type=payload["content_type"], content_id=str(content_id)
        )
    except Exception:
        logger.opt(exception=True).warning("content-change recipient gate failed; dropping hint")
        return None
