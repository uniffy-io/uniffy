from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


async def resolve_agent_folders(
    session: AsyncSession,
    subject: AccessSubject,
    folder_ids: Collection[UUID],
) -> dict[ResourceKey, ResourceAccessDecision]:
    folders = set()
    if folder_ids and subject.is_active_member:
        folders = set(
            (
                await session.execute(
                    select(ChatAgentFolder.id).where(
                        ChatAgentFolder.id.in_(folder_ids),
                        ChatAgentFolder.organization_id == subject.organization_id,
                        ChatAgentFolder.user_id == subject.user_id,
                    )
                )
            ).scalars()
        )
    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for content_id in folder_ids:
        key = ResourceKey(ContentType.AGENT_FOLDER, content_id)
        live = content_id in folders
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE if live else ResourceRowState.MISSING,
            can_view=live,
            role=ContentRole.OWNER if live else None,
        )
    return decisions
