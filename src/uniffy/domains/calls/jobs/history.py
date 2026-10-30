from typing import Any, cast

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.calls import Call
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY, SearchIndexer
from uniffy.domains.calls.invitations import CallInvitations
from uniffy.domains.calls.search import CallProjection
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="calls.jobs.history")


async def flush_call_history(ctx: dict[str, Any]) -> dict[str, int]:
    async with open_session() as session:
        expired = await CallInvitations(session).expire()
        ids = list(
            await session.scalars(
                select(Call.id).where(Call.search_pending.is_(True)).order_by(Call.id).limit(100)
            )
        )
    projected = 0
    for call_id in ids:
        async with open_session() as session:
            try:
                call = await session.scalar(
                    select(Call)
                    .where(Call.id == call_id, Call.search_pending.is_(True))
                    .with_for_update(skip_locked=True)
                )
                if call is None:
                    continue
                await CallProjection(
                    session, cast(SearchIndexer, ctx[SEARCH_INDEXER_CTX_KEY])
                ).project(call)
                call.search_pending = False
                await session.commit()
                projected += 1
            except Exception:
                await session.rollback()
                logger.opt(exception=True).warning(
                    "Call history projection failed", call_id=str(call_id)
                )
    return {"expired": expired, "projected": projected}
