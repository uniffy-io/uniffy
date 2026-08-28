"""Chat draft operations; PG-direct upserts, user-stream fanout after commit."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import is_active_member
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.draft import ChatDraft
from uniffy.core.models.chat.message import ChatMessage
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.operations import MAX_MESSAGE_LENGTH
from uniffy.domains.chat.streaming.events import (
    DRAFT_CHANGED,
    build_draft_changed_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_user_chat_event

logger = logger.bind(component="chat.drafts.operations")

MAX_CLIENT_SESSION_ID_LENGTH = 64
LIST_DRAFTS_LIMIT = 200


class ChatDraftOperations:
    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def save_draft(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID | None,
        content: str,
        client_session_id: str = "",
    ) -> ChatDraft:
        if len(client_session_id) > MAX_CLIENT_SESSION_ID_LENGTH:
            raise ValidationError("client_session_id", "client_session_id too long")
        if len(content) > MAX_MESSAGE_LENGTH:
            raise ValidationError("content", f"Draft exceeds {MAX_MESSAGE_LENGTH} characters")

        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        if root_message_id is not None:
            root_result = await self.session.execute(
                select(ChatMessage.channel_id).where(ChatMessage.id == root_message_id)
            )
            root_channel_id = root_result.scalar_one_or_none()
            if root_channel_id is None or root_channel_id != channel_id:
                raise NotFoundError("message", root_message_id)

        if not content.strip():
            await self.delete_draft(
                user_id, organization_id, channel_id, root_message_id, client_session_id
            )
            return ChatDraft(
                user_id=user_id,
                organization_id=organization_id,
                channel_id=channel_id,
                root_message_id=root_message_id,
                content="",
                updated_at=datetime.now(UTC),
            )

        now = datetime.now(UTC)
        values = {
            "user_id": user_id,
            "organization_id": organization_id,
            "channel_id": channel_id,
            "root_message_id": root_message_id,
            "content": content,
            "updated_at": now,
        }
        if root_message_id is None:
            stmt = (
                pg_insert(ChatDraft)
                .values(**values)
                .on_conflict_do_update(
                    index_elements=["user_id", "channel_id"],
                    index_where=ChatDraft.root_message_id.is_(None),
                    set_={"content": content, "updated_at": now},
                )
            )
        else:
            stmt = (
                pg_insert(ChatDraft)
                .values(**values)
                .on_conflict_do_update(
                    index_elements=["user_id", "channel_id", "root_message_id"],
                    index_where=ChatDraft.root_message_id.is_not(None),
                    set_={"content": content, "updated_at": now},
                )
            )
        try:
            await self.session.execute(stmt)
            await self.session.commit()
        except IntegrityError:
            # Referenced channel/message vanished between the access check and
            # the upsert. Convert before it can escape: a raw DB error string
            # embeds the bound parameters, including the draft content.
            await self.session.rollback()
            logger.warning(f"draft upsert integrity failure for user {user_id} channel {channel_id}")
            raise NotFoundError(
                "message" if root_message_id else "channel",
                root_message_id or channel_id,
            )

        await self._publish(
            user_id,
            channel_id,
            root_message_id,
            content=content,
            deleted=False,
            updated_at=now,
            client_session_id=client_session_id,
        )

        return ChatDraft(
            user_id=user_id,
            organization_id=organization_id,
            channel_id=channel_id,
            root_message_id=root_message_id,
            content=content,
            updated_at=now,
        )

    async def delete_draft(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID | None,
        client_session_id: str = "",
    ) -> bool:
        if len(client_session_id) > MAX_CLIENT_SESSION_ID_LENGTH:
            raise ValidationError("client_session_id", "client_session_id too long")

        stmt = delete(ChatDraft).where(
            ChatDraft.user_id == user_id,
            ChatDraft.organization_id == organization_id,
            ChatDraft.channel_id == channel_id,
        )
        if root_message_id is None:
            stmt = stmt.where(ChatDraft.root_message_id.is_(None))
        else:
            stmt = stmt.where(ChatDraft.root_message_id == root_message_id)

        result = await self.session.execute(stmt.returning(ChatDraft.id))
        deleted = result.first() is not None
        await self.session.commit()

        if deleted:
            await self._publish(
                user_id,
                channel_id,
                root_message_id,
                content="",
                deleted=True,
                updated_at=datetime.now(UTC),
                client_session_id=client_session_id,
            )
        return deleted

    async def list_drafts(self, user_id: UUID, organization_id: UUID) -> list[ChatDraft]:
        if not await is_active_member(user_id, organization_id, session=self.session):
            return []

        result = await self.session.execute(
            select(ChatDraft)
            .where(
                ChatDraft.user_id == user_id,
                ChatDraft.organization_id == organization_id,
            )
            .order_by(ChatDraft.updated_at.desc())
            .limit(LIST_DRAFTS_LIMIT)
        )
        return list(result.scalars().all())

    async def clear_for_send(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID | None,
    ) -> None:
        """Delete the sender's draft after a send; empty session id so every device clears."""
        try:
            await self.delete_draft(user_id, organization_id, channel_id, root_message_id)
        except Exception:
            logger.warning(f"draft clear failed for user {user_id} channel {channel_id}")

    async def _publish(
        self,
        user_id: UUID,
        channel_id: UUID,
        root_message_id: UUID | None,
        *,
        content: str,
        deleted: bool,
        updated_at: datetime,
        client_session_id: str,
    ) -> None:
        try:
            await publish_user_chat_event(
                user_id,
                DRAFT_CHANGED,
                build_draft_changed_payload(
                    channel_id,
                    root_message_id,
                    content,
                    deleted,
                    updated_at,
                    client_session_id,
                ),
            )
        except Exception:
            logger.warning(f"draft event publish failed for user {user_id} channel {channel_id}")
