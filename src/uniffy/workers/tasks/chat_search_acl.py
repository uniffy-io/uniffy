"""Refresh historical chat-message ACL snapshots from durable queue rows."""

from typing import Any
from uuid import UUID, uuid4

from loguru import logger
from sqlalchemy import and_, delete, select, update

from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.search.meilisearch import get_meilisearch_client
from uniffy.core.types import SubjectType
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db import open_session
from uniffy.vendor.arq import Retry
from uniffy.workers.tasks import JobName

logger = logger.bind(component="workers.chat_search_acl")

_LOCK_TTL_SECONDS = 330
_FLUSH_BATCH = 100
_ATTEMPTS_ALERT_THRESHOLD = 60
_RELEASE_LOCK_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


def _lock_key(channel_id: UUID) -> str:
    return f"chat_search_acl:{channel_id}:lock"


async def _acquire_lock(channel_id: UUID) -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    token = uuid4().hex
    try:
        acquired = await client.set(
            _lock_key(channel_id),
            token,
            ex=_LOCK_TTL_SECONDS,
            nx=True,
        )
        return token if acquired else None
    except Exception:
        logger.warning(f"Chat search ACL lock failed for channel {channel_id}")
        return None


async def _release_lock(channel_id: UUID, token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.eval(_RELEASE_LOCK_SCRIPT, 1, _lock_key(channel_id), token)
    except Exception:
        logger.warning(f"Chat search ACL lock release failed for channel {channel_id}")


async def _record_failure(channel_id: UUID, version: int) -> None:
    async with open_session() as session:
        await session.execute(
            update(ChatSearchAclRefresh)
            .where(
                ChatSearchAclRefresh.channel_id == channel_id,
                ChatSearchAclRefresh.version == version,
            )
            .values(attempts=ChatSearchAclRefresh.attempts + 1)
        )
        await session.commit()


async def _process_channel(channel_id: UUID) -> dict[str, Any]:
    async with open_session() as session:
        row = (
            await session.execute(
                select(ChatSearchAclRefresh).where(ChatSearchAclRefresh.channel_id == channel_id)
            )
        ).scalar_one_or_none()
        if row is None:
            return {"status": "empty"}

        version = row.version
        member_result = await session.execute(
            select(ChatChannelMember.user_id)
            .join(
                OrganizationMember,
                and_(
                    OrganizationMember.organization_id == row.organization_id,
                    OrganizationMember.user_id == ChatChannelMember.user_id,
                    OrganizationMember.is_active.is_(True),
                ),
            )
            .where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
            )
        )
        member_ids = [user_id for user_id in member_result.scalars().all() if user_id]

        try:
            updated = await get_meilisearch_client().update_chat_message_sharing(
                organization_id=row.organization_id,
                channel_id=channel_id,
                shared_user_ids=member_ids,
            )
        except Exception:
            await session.rollback()
            await _record_failure(channel_id, version)
            raise

        deleted = await session.execute(
            delete(ChatSearchAclRefresh).where(
                ChatSearchAclRefresh.channel_id == channel_id,
                ChatSearchAclRefresh.version == version,
            )
        )
        await session.commit()
        if not deleted.rowcount:
            return {"status": "superseded", "updated": updated}
        return {"status": "complete", "updated": updated}


async def refresh_chat_search_acl(
    ctx: dict[str, Any],
    channel_id: str,
) -> dict[str, Any]:
    parsed_channel_id = UUID(channel_id)
    lock_token = await _acquire_lock(parsed_channel_id)
    if lock_token is None:
        return {"status": "locked"}
    try:
        return await _process_channel(parsed_channel_id)
    except Exception as exc:
        logger.opt(exception=True).warning(
            f"Chat search ACL refresh failed for channel {parsed_channel_id}"
        )
        raise Retry(defer=max(10, ctx.get("job_try", 1) * 10)) from exc
    finally:
        await _release_lock(parsed_channel_id, lock_token)


async def flush_chat_search_acl_refreshes(ctx: dict[str, Any]) -> dict[str, Any]:
    async with open_session() as session:
        rows = (
            await session.execute(
                select(ChatSearchAclRefresh.channel_id, ChatSearchAclRefresh.attempts)
                .order_by(ChatSearchAclRefresh.created_at)
                .limit(_FLUSH_BATCH)
            )
        ).all()

    queue = ctx.get("valkey")
    if queue is None:
        return {"status": "skipped", "reason": "queue_unavailable"}

    enqueued = 0
    failed = 0
    stuck = sum(1 for _channel_id, attempts in rows if attempts >= _ATTEMPTS_ALERT_THRESHOLD)
    for channel_id, _attempts in rows:
        try:
            await queue.enqueue_job(
                JobName.REFRESH_CHAT_SEARCH_ACL,
                str(channel_id),
            )
            enqueued += 1
        except Exception:
            failed += 1

    if stuck:
        logger.error(f"Chat search ACL refresh has {stuck} persistently failing rows")
    return {"status": "complete", "enqueued": enqueued, "failed": failed}
