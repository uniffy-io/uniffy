from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import register_content_loader, register_role_resolver
from uniffy.core.models.calls import Call
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.calls.history import CallHistoryReader


async def _load_call(session: AsyncSession, organization_id: UUID, content_id: UUID) -> Call | None:
    return await session.scalar(
        select(Call).where(Call.id == content_id, Call.organization_id == organization_id)
    )


async def _call_role(
    session: AsyncSession, user_id: UUID, organization_id: UUID, content: object
) -> ContentRole | None:
    if not isinstance(content, Call):
        return None
    return await CallHistoryReader(session)._resolve_role(user_id, organization_id, content)


def register_call_content() -> None:
    register_content_loader(ContentType.CALL, _load_call)
    register_role_resolver(ContentType.CALL, _call_role)
