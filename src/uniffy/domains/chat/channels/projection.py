"""Focused chat channel projection behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, func, select

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.errors import (
    PermissionDeniedError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
)
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentType,
)
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="chat.channels.projection")


class ChannelProjection:
    def _build_search_keywords(self, model: ChatChannel) -> str:
        # Include both auto-name and custom override so renamed agent chats stay findable.
        if model.custom_name:
            return f"{model.custom_name} {model.name} {model.description}"
        return f"{model.name} {model.description}"

    def _get_search_title(self, model: ChatChannel) -> str:
        return model.effective_name

    def _get_url_path(self, model: ChatChannel) -> str:
        return f"/chat/{model.id}"

    def _get_search_description(self, model: ChatChannel) -> str | None:
        return model.description[:200] if model.description else None

    async def _get_search_tags_async(self, model: ChatChannel) -> list[str] | None:
        """Tag slug list for this channel; skipped for DM/agent-DM (no tags)."""
        if model.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            return None
        tag_ops = TagOperations(self.session, self.search_indexer)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery returning channel ids carrying every tag in tag_ids (AND via HAVING COUNT)."""
        urn_prefix = "urn:uniffy:content:CHAT:"
        urn_expr = func.concat(urn_prefix, cast(ChatChannel.id, String))
        return (
            select(ChatChannel.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(ChatChannel.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _sync_channel_tags(
        self,
        *,
        actor_id: UUID,
        channel: ChatChannel,
        tag_ids: list[UUID] | None,
    ) -> None:
        # tag_ids=None leaves manual assignments untouched; DMs are skipped entirely.
        if tag_ids is None:
            return
        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            return
        tag_ops = TagOperations(self.session, self.search_indexer)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=channel.organization_id,
            content_urn=build_content_urn(self.content_type, channel.id),
            tag_ids=tag_ids,
        )

    async def _require_view(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        await self.access.check_access(user_id, organization_id, content)

    async def _require_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Channel admins/owners, org admins, or chat domain admins can edit."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        member = await self.access.get_membership(content.id, user_id)
        if not member or member.role == ChannelRole.MEMBER:
            raise PermissionDeniedError("edit", "channel")

    async def _require_delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: ChatChannel,
    ) -> None:
        """Only channel owner, org admin, or chat domain admin can delete."""
        if await self.access.is_org_admin(user_id, organization_id):
            return
        if await self.access.is_chat_domain_admin(user_id, organization_id):
            return
        member = await self.access.get_membership(content.id, user_id)
        if not member or member.role != ChannelRole.OWNER:
            raise PermissionDeniedError("delete", "channel")

    async def _index_for_search(
        self,
        model: ChatChannel,
        skip_member_lookup: bool = False,
    ) -> None:
        """Index PUBLIC as OPEN_TO_ORG, PRIVATE/agent-DM as EXPLICIT_MEMBERS; user DMs excluded."""
        del skip_member_lookup  # membership is always the source of truth

        if model.channel_type == ChannelType.GROUP_DM:
            return
        if model.channel_type == ChannelType.DIRECT and not model.is_agent_dm:
            return

        if model.is_agent_dm:
            access_mode = AccessMode.EXPLICIT_MEMBERS.value
            shared_user_ids = [model.owner_id]
        elif model.channel_type == ChannelType.PUBLIC:
            access_mode = AccessMode.OPEN_TO_ORG.value
            shared_user_ids = None
        else:
            access_mode = AccessMode.EXPLICIT_MEMBERS.value
            member_ids = await self._get_all_member_ids(model.id)
            shared_user_ids = member_ids if member_ids else None

        stats_result = await self.session.execute(
            select(ChatChannelStats.member_count).where(ChatChannelStats.channel_id == model.id)
        )
        member_count = stats_result.scalar_one_or_none() or 0

        category_name = ""
        if model.category_id:
            cat_result = await self.session.execute(
                select(ChatChannelCategory.name).where(ChatChannelCategory.id == model.category_id)
            )
            category_name = cat_result.scalar_one_or_none() or ""

        # Agent DMs use their own content type so search UI can filter/style them distinctly.
        urn_type = ContentType.AGENT_CHAT if model.is_agent_dm else ContentType.CHAT
        entity_type = urn_type.value

        metadata = {
            "channel_type": model.channel_type.value,
            "member_count": str(member_count),
            "parent_label": category_name,
        }
        if model.is_agent_dm and model.agent_id is not None:
            metadata["agent_id"] = str(model.agent_id)
            # Agent identity rides the doc so search rows render the same
            # avatar (emoji or name-keyed gradient) as the chat sidebar.
            agent_row = await self.session.execute(
                select(Agent.name, Agent.avatar_emoji).where(Agent.id == model.agent_id)
            )
            agent_identity = agent_row.first()
            if agent_identity:
                metadata["agent_name"] = agent_identity[0]
                if agent_identity[1]:
                    metadata["emoji"] = agent_identity[1]

        await self.search_indexer.index(
            urn=f"urn:uniffy:content:{urn_type.value}:{model.id}",
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=entity_type,
            url_path=self._get_url_path(model),
            access_mode=access_mode,
            baseline_role=None,
            owner_id=model.owner_id,
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids,
            metadata=metadata,
        )

    async def _refresh_channel_live_state(self, channel: ChatChannel) -> None:
        """Re-index the channel and broadcast a mention-state change so chips reflect new state."""
        if channel.channel_type == ChannelType.GROUP_DM:
            return
        if channel.channel_type == ChannelType.DIRECT and not channel.is_agent_dm:
            return
        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to re-index channel {channel.id} live state")
            return
        try:
            stats_result = await self.session.execute(
                select(ChatChannelStats.member_count).where(
                    ChatChannelStats.channel_id == channel.id
                )
            )
            member_count = stats_result.scalar_one_or_none() or 0

            category_name = ""
            if channel.category_id:
                cat_result = await self.session.execute(
                    select(ChatChannelCategory.name).where(
                        ChatChannelCategory.id == channel.category_id
                    )
                )
                category_name = cat_result.scalar_one_or_none() or ""

            urn_type = ContentType.AGENT_CHAT if channel.is_agent_dm else ContentType.CHAT
            await publish_mention_state(
                organization_id=channel.organization_id,
                urn=f"urn:uniffy:content:{urn_type.value}:{channel.id}",
                changes={
                    "title": channel.effective_name,
                    "description": channel.description or "",
                    "member_count": str(member_count),
                    "channel_type": channel.channel_type.value,
                    "parent_label": category_name,
                },
            )
        except Exception:
            logger.warning(f"Failed to publish mention state for channel {channel.id}")
