"""Durable scheduling for historical chat-message search ACL refreshes."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import enqueue_job
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.domains.chat.jobs.contracts import REFRESH_CHAT_SEARCH_ACL

logger = logger.bind(component="chat.search")


async def record_chat_search_acl_refresh(
    session: AsyncSession,
    *,
    organization_id: UUID,
    channel_id: UUID,
) -> None:
    stmt = (
        pg_insert(ChatSearchAclRefresh)
        .values(
            channel_id=channel_id,
            organization_id=organization_id,
            version=1,
            attempts=0,
            created_at=datetime.now(UTC),
        )
        .on_conflict_do_update(
            index_elements=["channel_id"],
            set_={
                "organization_id": organization_id,
                "version": ChatSearchAclRefresh.version + 1,
                "attempts": 0,
                "created_at": datetime.now(UTC),
            },
        )
    )
    await session.execute(stmt)


async def enqueue_chat_search_acl_refresh(channel_id: UUID) -> None:
    try:
        await enqueue_job(REFRESH_CHAT_SEARCH_ACL, str(channel_id))
    except RuntimeError:
        logger.warning(f"Search ACL refresh queued in DB only for channel {channel_id}")
    except Exception:
        logger.opt(exception=True).warning(
            f"Failed to enqueue search ACL refresh for channel {channel_id}"
        )
