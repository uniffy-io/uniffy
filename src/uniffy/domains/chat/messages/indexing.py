"""Search and resource projection for chat messages."""

from uuid import UUID

from loguru import logger

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.content.references import is_mention_only_content, strip_mentions_to_labels
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.chat.messages.broadcasts import find_broadcast_peer
from uniffy.domains.chat.resources.operations import ChatResourceOperations
from uniffy.domains.chat.senders import SenderResolver

logger = logger.bind(component="chat.messages.indexing")


class MessageIndexing:
    async def _index_message(
        self,
        message: ChatMessage,
        channel: ChatChannel,
        member_ids: list[UUID],
        sender_name: str = "",
    ) -> None:
        # System messages are UI narration rather than searchable content.
        if message.sender_type == SenderType.SYSTEM:
            return

        try:
            peer = await find_broadcast_peer(self.session, message)
        except Exception:
            logger.opt(exception=True).warning("Broadcast lookup failed for message {}", message.id)
            return
        if peer is not None:
            reply, copy = (message, peer) if message.root_id is not None else (peer, message)
            canonical = copy if not copy.is_deleted else reply
            redundant = reply if canonical.id == copy.id else copy
            try:
                await self.search_indexer.remove(f"urn:uniffy:content:CHAT_MESSAGE:{redundant.id}")
            except Exception:
                logger.warning("Search remove failed for broadcast peer {}", redundant.id)
            message = canonical

        if message.is_deleted:
            return

        if is_mention_only_content(message.content):
            try:
                urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
                await self.search_indexer.remove(urn)
            except Exception:
                logger.warning("Search remove failed for mention-only message {}", message.id)
            return

        try:
            if not sender_name:
                resolver = SenderResolver(self.session)
                info = await resolver.resolve_one(message.sender_type, message.sender_id)
                sender_name = info.display_name

            plain = strip_mentions_to_labels(message.content)

            if channel.channel_type == ChannelType.PUBLIC:
                access_mode = AccessMode.OPEN_TO_ORG
                baseline_role: ContentRole | None = ContentRole.VIEWER
                shared_user_ids = None
            else:
                access_mode = AccessMode.EXPLICIT_MEMBERS
                baseline_role = None
                shared_user_ids = member_ids if member_ids else None

            urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
            await self.search_indexer.index(
                urn=urn,
                organization_id=channel.organization_id,
                title=plain[:120],
                entity_type="chat_message",
                url_path=f"/chat/{channel.id}#{message.id}",
                access_mode=access_mode,
                baseline_role=baseline_role,
                owner_id=message.sender_id,
                keywords=plain,
                description=plain[:300],
                shared_user_ids=shared_user_ids,
                metadata={
                    "channel_id": str(channel.id),
                    "channel_name": channel.name,
                    "channel_type": channel.channel_type.value,
                    "sender_id": str(message.sender_id),
                    "sender_name": sender_name,
                    "parent_label": f"#{channel.name}",
                },
            )

            try:
                await publish_mention_state(
                    organization_id=channel.organization_id,
                    urn=urn,
                    changes={
                        "title": plain[:120],
                        "description": plain[:300],
                        "parent_label": f"#{channel.name}",
                        "sender_name": sender_name,
                        "channel_type": channel.channel_type.value,
                    },
                )
            except Exception:
                logger.warning("Failed to publish mention state for message {}", message.id)
        except Exception:
            logger.warning("Search indexing failed for message {}", message.id)

    async def _update_resources(
        self,
        channel_id: UUID,
        content: str,
        sender_id: UUID,
    ) -> None:
        try:
            ops = ChatResourceOperations(self.session)
            await ops.update_resources_from_message(channel_id, content, sender_id)
        except Exception:
            logger.warning("Resource tracking failed for channel {}", channel_id)
