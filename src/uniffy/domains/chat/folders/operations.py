"""Agent-chat folder operations; every row is private to its owning user."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import AccessMode, ContentType, SubjectType
from uniffy.domains.chat.cache import invalidate_cached_member_ids

logger = logger.bind(component="chat.folders.operations")

MAX_FOLDERS_PER_USER = 100


class AgentFolderOperations:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def _index_for_search(self, folder: ChatAgentFolder) -> None:
        """Folders are private to their owner, so the doc is OWNER_ONLY."""
        try:
            await self.search_indexer.index(
                urn=build_content_urn(ContentType.AGENT_FOLDER, folder.id),
                organization_id=folder.organization_id,
                title=folder.name,
                entity_type=ContentType.AGENT_FOLDER.value,
                url_path=f"/chat?agentFolder={folder.id}",
                owner_id=folder.user_id,
                access_mode=AccessMode.OWNER_ONLY.value,
                baseline_role=None,
                keywords=folder.name,
            )
        except Exception:
            logger.warning(f"Search index failed for agent folder {folder.id}")

    async def _remove_from_search(self, folder_id: UUID, organization_id: UUID) -> None:
        try:
            await self.search_indexer.remove(
                build_content_urn(ContentType.AGENT_FOLDER, folder_id),
                organization_id,
            )
        except Exception:
            logger.warning(f"Search remove failed for agent folder {folder_id}")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
    ) -> ChatAgentFolder:
        clean = name.strip()
        if not clean:
            raise ValidationError("name", "Folder name cannot be empty")
        if len(clean) > 100:
            raise ValidationError("name", "Folder name too long (max 100)")

        existing = await self.list_folders(user_id, organization_id)
        if len(existing) >= MAX_FOLDERS_PER_USER:
            raise ValidationError("name", "Folder limit reached")
        if any(f.name == clean for f in existing):
            raise ValidationError("name", "A folder with this name already exists")

        folder = ChatAgentFolder(
            organization_id=organization_id,
            user_id=user_id,
            name=clean,
            position=(existing[-1].position + 1) if existing else 0,
        )
        self.session.add(folder)
        await self.session.commit()
        await self.session.refresh(folder)
        await self._index_for_search(folder)
        return folder

    async def rename(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
        name: str,
    ) -> ChatAgentFolder:
        clean = name.strip()
        if not clean:
            raise ValidationError("name", "Folder name cannot be empty")
        if len(clean) > 100:
            raise ValidationError("name", "Folder name too long (max 100)")

        folder = await self._get_owned(user_id, organization_id, folder_id)
        duplicate = await self.session.execute(
            select(ChatAgentFolder.id).where(
                ChatAgentFolder.organization_id == organization_id,
                ChatAgentFolder.user_id == user_id,
                ChatAgentFolder.name == clean,
                ChatAgentFolder.id != folder_id,
            )
        )
        if duplicate.scalar_one_or_none():
            raise ValidationError("name", "A folder with this name already exists")

        folder.name = clean
        folder.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(folder)
        await self._index_for_search(folder)
        return folder

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
    ) -> None:
        """Delete a folder; its chats move back to the unfiled root."""
        folder = await self._get_owned(user_id, organization_id, folder_id)
        folder_org_id = folder.organization_id

        affected = await self.session.execute(
            select(ChatChannelMember.channel_id).where(
                ChatChannelMember.agent_folder_id == folder_id
            )
        )
        affected_ids = list(affected.scalars().all())

        await self.session.execute(
            update(ChatChannelMember)
            .where(ChatChannelMember.agent_folder_id == folder_id)
            .values(agent_folder_id=None)
        )
        await self.session.delete(folder)
        await self.session.commit()

        await self._remove_from_search(folder_id, folder_org_id)

        for cid in affected_ids:
            await invalidate_cached_member_ids(cid)

    async def list_folders(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[ChatAgentFolder]:
        result = await self.session.execute(
            select(ChatAgentFolder)
            .where(
                ChatAgentFolder.organization_id == organization_id,
                ChatAgentFolder.user_id == user_id,
            )
            .order_by(ChatAgentFolder.position, ChatAgentFolder.name)
        )
        return list(result.scalars().all())

    async def set_chat_folder(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        folder_id: UUID | None,
    ) -> None:
        """File the user's agent DM into a folder (None = unfiled)."""
        channel_result = await self.session.execute(
            select(ChatChannel).where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
            )
        )
        channel = channel_result.scalar_one_or_none()
        if not channel or channel.is_deleted:
            raise NotFoundError("channel", channel_id)
        if not channel.is_agent_dm:
            raise ValidationError("channel_id", "Folders only apply to agent chats")

        if folder_id is not None:
            await self._get_owned(user_id, organization_id, folder_id)

        result = await self.session.execute(
            update(ChatChannelMember)
            .where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == user_id,
            )
            .values(agent_folder_id=folder_id)
        )
        if result.rowcount == 0:
            raise NotFoundError("membership", channel_id)
        await self.session.commit()
        await invalidate_cached_member_ids(channel_id)

    async def _get_owned(
        self,
        user_id: UUID,
        organization_id: UUID,
        folder_id: UUID,
    ) -> ChatAgentFolder:
        result = await self.session.execute(
            select(ChatAgentFolder).where(
                ChatAgentFolder.id == folder_id,
                ChatAgentFolder.organization_id == organization_id,
                ChatAgentFolder.user_id == user_id,
            )
        )
        folder = result.scalar_one_or_none()
        if not folder:
            raise NotFoundError("folder", folder_id)
        return folder
