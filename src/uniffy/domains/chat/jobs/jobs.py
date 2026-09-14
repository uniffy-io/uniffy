"""Run chat background work."""

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, select, update

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.json_codec import loads
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY, SearchIndexer
from uniffy.core.search.workspace import WORKSPACE_SEARCH_CTX_KEY, WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.chat.jobs.contracts import REFRESH_CHAT_SEARCH_ACL
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.files.attachments.derived import refresh_attachment_parent_search
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client
from uniffy.vendor.arq import Retry

logger = logger.bind(component="chat.jobs.jobs")

_LOCK_TTL_SECONDS = 330
_FLUSH_BATCH = 100
_ATTEMPTS_ALERT_THRESHOLD = 60


async def post_send_chat_message(
    ctx: dict[str, Any],
    message_id: str,
    channel_id: str,
    user_id: str,
    root_id: str | None,
    sender_name: str,
    member_ids_json: str,
    channel_copy_id: str | None = None,
) -> dict[str, Any]:
    try:
        mid = UUID(message_id)
        cid = UUID(channel_id)
        uid = UUID(user_id)
        rid = UUID(root_id) if root_id is not None else None
        member_ids = [UUID(value) for value in loads(member_ids_json)]
        copy_id = UUID(channel_copy_id) if channel_copy_id is not None else None
    except TypeError, ValueError:
        return {"status": "error", "reason": "invalid_payload"}

    session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    search_indexer = cast(SearchIndexer, ctx[SEARCH_INDEXER_CTX_KEY])
    async with session_factory() as session:
        message = await session.get(ChatMessage, mid)
        channel = await session.get(ChatChannel, cid)
        if message is None or channel is None:
            return {"status": "skipped", "reason": "message_or_channel_missing"}
        # A reply broadcast to its channel is one message in two rows; the
        # channel row is the one that carries the search document. Pinned to
        # this channel so a crafted payload cannot index a message from another
        # channel under this channel's audience.
        channel_copy = None
        if copy_id is not None:
            channel_copy = (
                await session.execute(
                    select(ChatMessage).where(
                        ChatMessage.id == copy_id,
                        ChatMessage.channel_id == cid,
                    )
                )
            ).scalar_one_or_none()
        await ChatMessageOperations(session, search_indexer=search_indexer).background_post_send(
            message,
            channel,
            uid,
            rid,
            sender_name,
            member_ids,
            index_message=channel_copy,
        )
    return {"status": "success", "message_id": message_id}


def _lock_key(channel_id: UUID) -> str:
    return f"chat_search_acl:{channel_id}:lock"


async def _acquire_lock(channel_id: UUID) -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(
            client,
            _lock_key(channel_id),
            _LOCK_TTL_SECONDS,
        )
    except Exception:
        logger.warning(f"Chat search ACL lock failed for channel {channel_id}")
        return None


async def _release_lock(channel_id: UUID, token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _lock_key(channel_id), token)
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


async def _process_channel(
    channel_id: UUID,
    search: WorkspaceSearch,
) -> dict[str, Any]:
    async with open_session() as session:
        row = (
            await session.execute(
                select(ChatSearchAclRefresh).where(ChatSearchAclRefresh.channel_id == channel_id)
            )
        ).scalar_one_or_none()
        if row is None:
            return {"status": "empty"}

        version = row.version
        channel_type = (
            await session.execute(
                select(ChatChannel.channel_type).where(
                    ChatChannel.id == channel_id,
                    ChatChannel.organization_id == row.organization_id,
                )
            )
        ).scalar_one_or_none()
        if channel_type is None:
            await session.execute(
                delete(ChatSearchAclRefresh).where(ChatSearchAclRefresh.channel_id == channel_id)
            )
            await session.commit()
            return {"status": "skipped", "reason": "channel_missing"}

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

        # Derived from the channel's live type rather than carried on the row, so
        # a replay after a second flip writes the current answer and any doc that
        # drifted is healed by the next refresh. Must match the shapes
        # `ChatMessageIndexing` writes at send time.
        is_public = channel_type == ChannelType.PUBLIC
        access_mode = (AccessMode.OPEN_TO_ORG if is_public else AccessMode.EXPLICIT_MEMBERS).value
        baseline_role = ContentRole.VIEWER.value if is_public else None

        try:
            updated = await search.update_chat_message_sharing(
                organization_id=row.organization_id,
                channel_id=channel_id,
                # An open-up must not leave the old roster behind on docs that
                # now grant org-wide.
                shared_user_ids=[] if is_public else member_ids,
                access_mode=access_mode,
                baseline_role=baseline_role,
            )
            await refresh_attachment_parent_search(
                session,
                SearchIndexer(search),
                organization_id=row.organization_id,
                content_type=ContentType.CHAT_MESSAGE,
                content_ids=select(ChatMessage.id).where(ChatMessage.channel_id == channel_id),
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
        return await _process_channel(
            parsed_channel_id,
            ctx[WORKSPACE_SEARCH_CTX_KEY],
        )
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
                REFRESH_CHAT_SEARCH_ACL.name,
                str(channel_id),
            )
            enqueued += 1
        except Exception:
            failed += 1

    if stuck:
        logger.error(f"Chat search ACL refresh has {stuck} persistently failing rows")
    return {"status": "complete", "enqueued": enqueued, "failed": failed}


async def auto_unmute_channels(ctx: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(UTC)
    async with open_session() as session:
        result = await session.execute(
            update(ChatChannelMember)
            .where(
                ChatChannelMember.is_muted == True,  # noqa: E712
                ChatChannelMember.muted_until.isnot(None),
                ChatChannelMember.muted_until < now,
            )
            .values(is_muted=False, muted_until=None)
        )
        count = result.rowcount
        await session.commit()

    if count > 0:
        logger.info(f"Auto-unmuted {count} channel memberships")
    return {"status": "success", "unmuted": count}
