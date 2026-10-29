from collections.abc import Collection
from dataclasses import replace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls import Call
from uniffy.core.types import ContentType
from uniffy.domains.chat.resources.access import resolve_chat_resources
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import ResourceAccessDecision, ResourceKey


async def resolve_calls(
    session: AsyncSession, subject: AccessSubject, call_ids: Collection[UUID]
) -> dict[ResourceKey, ResourceAccessDecision]:
    rows = (
        await session.execute(
            select(Call.id, Call.channel_id).where(
                Call.organization_id == subject.organization_id, Call.id.in_(call_ids)
            )
        )
    ).all()
    parents = await resolve_chat_resources(
        session, subject, {ContentType.CHAT: {row.channel_id for row in rows}}
    )
    return {
        ResourceKey(ContentType.CALL, row.id): replace(
            parents[ResourceKey(ContentType.CHAT, row.channel_id)],
            key=ResourceKey(ContentType.CALL, row.id),
        )
        for row in rows
    }
