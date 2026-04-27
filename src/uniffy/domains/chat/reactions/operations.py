"""Chat reaction operations with SQL-level aggregation."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.reaction import ChatReaction
from uniffy.core.types import SubjectType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import fetch_channel_members


class ChatReactionOperations:
    """Reaction add/remove/query operations."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def add_reaction(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        emoji: str,
        display_name: str = "",
    ) -> ChatReaction:
        """Add a reaction to a message. Idempotent (unique constraint).

        Uses ``ON CONFLICT DO NOTHING RETURNING created_at`` so the inserted
        row's authoritative timestamp is captured in one round-trip. When
        the row already existed RETURNING yields no rows; in that case
        ``now`` is returned as an approximate ``created_at`` to avoid the
        extra SELECT round-trip - the value is only used for the realtime
        payload, not stored.
        """
        await self._verify_message_access(user_id, organization_id, channel_id, message_id)

        now = datetime.now(UTC)

        result = await self.session.execute(
            pg_insert(ChatReaction)
            .values(
                message_id=message_id,
                user_id=user_id,
                emoji=emoji,
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=["message_id", "user_id", "emoji"])
            .returning(ChatReaction.created_at)
        )
        await self.session.commit()
        returned = result.scalar_one_or_none()
        created_at = returned if returned is not None else now

        reaction = ChatReaction(
            message_id=message_id,
            user_id=user_id,
            emoji=emoji,
            created_at=created_at,
        )

        member_ids = await self._get_channel_member_ids(channel_id)
        await self._publish_reaction_event(
            channel_id,
            message_id,
            emoji,
            user_id,
            "added",
            display_name,
            member_ids,
        )

        return reaction

    async def remove_reaction(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        emoji: str,
        display_name: str = "",
    ) -> None:
        """Remove a reaction from a message."""
        await self._verify_message_access(user_id, organization_id, channel_id, message_id)

        await self.session.execute(
            delete(ChatReaction).where(
                ChatReaction.message_id == message_id,
                ChatReaction.user_id == user_id,
                ChatReaction.emoji == emoji,
            )
        )
        await self.session.commit()

        member_ids = await self._get_channel_member_ids(channel_id)
        await self._publish_reaction_event(
            channel_id,
            message_id,
            emoji,
            user_id,
            "removed",
            display_name,
            member_ids,
        )

    async def _publish_reaction_event(
        self,
        channel_id: UUID,
        message_id: UUID,
        emoji: str,
        user_id: UUID,
        action: str,
        display_name: str,
        member_ids: list[UUID],
    ) -> None:
        """Publish a reaction event to channel members.

        Caller passes pre-fetched ``member_ids`` so reactions never re-query
        the channel-member list per emoji-tap.
        """
        try:
            from uniffy.domains.chat.streaming.events import (
                REACTION_ADDED,
                REACTION_REMOVED,
                build_reaction_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            event_type = REACTION_ADDED if action == "added" else REACTION_REMOVED
            await publish_channel_event_to_members(
                member_ids,
                event_type,
                build_reaction_payload(message_id, emoji, user_id, display_name),
                channel_id=channel_id,
            )
        except Exception:
            pass  # Non-fatal, best-effort

    async def _get_channel_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Fetch USER member ids for a channel via the member-id cache.

        Filters to ``subject_type=USER`` so AGENT rows whose ``user_id``
        is NULL never leak into fan-out target lists.
        """
        members = await fetch_channel_members(self.session, channel_id)
        ids: list[UUID] = []
        for member in members:
            if member.get("subject_type") != SubjectType.USER.value:
                continue
            uid = member.get("user_id")
            if not uid:
                continue
            try:
                ids.append(UUID(uid))
            except ValueError:
                continue
        return ids

    async def get_reactions_for_messages(
        self,
        message_ids: list[UUID],
        current_user_id: UUID,
    ) -> dict[UUID, list[dict]]:
        """Batch-fetch reactions grouped by message and emoji.

        Uses SQL aggregation to avoid over-fetching individual user rows.
        Returns {message_id: [{emoji, count, current_user_reacted}]}.
        """
        if not message_ids:
            return {}

        result = await self.session.execute(
            select(
                ChatReaction.message_id,
                ChatReaction.emoji,
                func.count().label("count"),
                func.bool_or(ChatReaction.user_id == current_user_id).label("current_user_reacted"),
            )
            .where(ChatReaction.message_id.in_(message_ids))
            .group_by(ChatReaction.message_id, ChatReaction.emoji)
            .order_by(ChatReaction.message_id, ChatReaction.emoji)
        )

        from collections import defaultdict

        reactions_map: dict[UUID, list[dict]] = defaultdict(list)
        for row in result.all():
            reactions_map[row[0]].append({
                "emoji": row[1],
                "count": row[2],
                "current_user_reacted": row[3],
            })

        return dict(reactions_map)

    # Internal helpers

    async def _verify_message_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> None:
        """Verify user can access the message's channel."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        # Verify message exists in channel
        msg_result = await self.session.execute(
            select(ChatMessage.id).where(
                ChatMessage.id == message_id,
                ChatMessage.channel_id == channel_id,
            )
        )
        if not msg_result.scalar_one_or_none():
            raise NotFoundError("message", message_id)
