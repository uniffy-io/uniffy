from collections.abc import Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.roles import role_can_comment, role_can_edit, role_can_view
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)

COMMENT_TARGET_TYPES = frozenset({
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.TASK,
})


class CommentTargetAccess:
    def __init__(self, session: AsyncSession) -> None:
        self._resources = ResourceAccessResolver(session)

    async def require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._require_role(
            user_id,
            organization_id,
            content_type,
            content_id,
            action="view",
            predicate=role_can_view,
        )

    async def require_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._require_role(
            user_id,
            organization_id,
            content_type,
            content_id,
            action="comment",
            predicate=role_can_comment,
        )

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._require_role(
            user_id,
            organization_id,
            content_type,
            content_id,
            action="edit",
            predicate=role_can_edit,
        )

    async def _require_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        *,
        action: str,
        predicate: Callable[[ContentRole | None], bool],
    ) -> None:
        if content_type not in COMMENT_TARGET_TYPES:
            raise NotFoundError("Content", str(content_id))
        key = ResourceKey(content_type, content_id)
        decision = (
            await self._resources.resolve(
                actor_id=user_id,
                organization_id=organization_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        )[key]
        if decision.row_state != ResourceRowState.LIVE:
            raise NotFoundError("Content", str(content_id))
        if not predicate(decision.role):
            raise PermissionDeniedError(action, "content")
