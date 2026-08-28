from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.roles import role_can_edit
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.chat.attachments import require_message_attachment_edit
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)

STANDARD_ATTACHMENT_TARGET_TYPES = frozenset({
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.CALENDAR_EVENT,
    ContentType.PROJECT,
    ContentType.TASK,
})


@dataclass(frozen=True, slots=True)
class AttachmentTargetPolicy:
    content_type: ContentType
    access_mode: AccessMode
    baseline_role: ContentRole | None


class AttachmentTargetAccess:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._resources = ResourceAccessResolver(session)

    async def require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> AttachmentTargetPolicy:
        if content_type == ContentType.CHAT_MESSAGE:
            policy = await require_message_attachment_edit(
                self._session,
                user_id=user_id,
                organization_id=organization_id,
                message_id=content_id,
            )
            return AttachmentTargetPolicy(
                ContentType.CHAT,
                policy.access_mode,
                policy.baseline_role,
            )

        if content_type not in STANDARD_ATTACHMENT_TARGET_TYPES:
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
        if not role_can_edit(decision.role):
            raise PermissionDeniedError("edit", "content")
        if decision.target_policy is None:
            raise RuntimeError(f"Missing target policy for {content_type.value}")
        return AttachmentTargetPolicy(
            decision.target_policy.content_type,
            decision.target_policy.access_mode,
            decision.target_policy.baseline_role,
        )


async def can_view_attached_file(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    file_id: UUID,
) -> bool:
    key = ResourceKey(ContentType.FILE, file_id)
    decision = (
        await ResourceAccessResolver(session).resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=[key],
            purpose=ResourceAccessPurpose.REFERENCE,
        )
    )[key]
    return decision.can_view
