from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.message import AgentMessageRole
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.search import SearchIndexer
from uniffy.core.search.policy import build_search_document
from uniffy.core.search.workspace import DocumentLookupResult, WorkspaceSearch
from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime.writers import ChatChannelMessageWriter
from uniffy.domains.bookmarks.operations import BookmarksOperations
from uniffy.domains.chat.agents import index_agent_message
from uniffy.domains.search.queries import UrnAvailability
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("index_available", [False, True])
async def test_saved_agent_reply_has_preview_and_obeys_live_access(
    session: AsyncSession,
    threads: SimpleNamespace,
    streaming: bool,
    index_available: bool,
) -> None:
    documents = {}
    content = "The launch review is ready."
    search = MagicMock(spec=WorkspaceSearch)

    async def index_document(item):
        async with open_session() as observer:
            persisted = await observer.get(ChatMessage, item.urn.rsplit(":", 1)[1])
            assert persisted is not None
            assert persisted.content == content
        if not index_available:
            raise ConnectionError("Search is unavailable")
        documents[item.urn] = build_search_document(item)

    async def lookup(urns, organization_id):
        return DocumentLookupResult(
            documents={
                urn: documents[urn]
                for urn in urns
                if urn in documents and documents[urn]["organization_id"] == str(organization_id)
            },
            failed_urns=frozenset(),
        )

    search.index_document = AsyncMock(side_effect=index_document)
    search.get_documents_by_urns = AsyncMock(side_effect=lookup)
    indexer = SearchIndexer(search)
    writer = ChatChannelMessageWriter(
        session=session,
        search_indexer=indexer,
        user_id=threads.user_id,
        organization_id=threads.org_id,
        channel_id=threads.channel_id,
        agent_id=threads.agent_id,
        trigger_message_id=threads.channel_last_id,
    )
    channel = await session.get(ChatChannel, threads.channel_id)
    channel.channel_type = ChannelType.DIRECT
    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == threads.org_id,
                OrganizationMember.user_id == threads.user_id,
            )
        )
    ).scalar_one()
    membership.role = OrganizationRole.MEMBER
    await session.commit()

    try:
        with patch("uniffy.domains.chat.messages.indexing.publish_mention_state", AsyncMock()):
            if streaming:
                placeholder = await writer.reserve_assistant_placeholder()
                assert placeholder is not None
                search.index_document.assert_not_awaited()
                message = await writer.finalize_assistant_placeholder(
                    message_id=placeholder.id,
                    content=content,
                )
                assert message.id == placeholder.id
            else:
                message = await writer.add_message(role=AgentMessageRole.ASSISTANT, content=content)

        search.index_document.assert_awaited_once()
        urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
        operations = BookmarksOperations(session, search)
        saved, bookmark = await operations.toggle(threads.user_id, threads.org_id, urn)
        assert saved and bookmark is not None
        page = await operations.list_bookmark_items(threads.user_id, threads.org_id)
        assert len(page.items) == 1
        preview = page.items[0].content
        if index_available:
            assert preview.availability == UrnAvailability.AVAILABLE
            assert preview.title == content
            assert preview.description == content
            assert preview.metadata["sender_name"].startswith("Scribe ")
            assert preview.url_path == f"/chat/{threads.channel_id}#{message.id}"
        else:
            assert preview.availability == UrnAvailability.UNAVAILABLE
            assert preview.title == ""

        row = await session.get(ChatMessage, message.id)
        assert row is not None and row.content == content
        search.index_document.reset_mock()
        await index_agent_message(session, indexer, row, generate_id())
        search.index_document.assert_not_awaited()

        await session.execute(
            delete(ChatChannelMember).where(
                ChatChannelMember.channel_id == threads.channel_id,
                ChatChannelMember.user_id == threads.user_id,
            )
        )
        await session.commit()
        search.get_documents_by_urns.reset_mock()
        revoked = await operations.list_bookmark_items(threads.user_id, threads.org_id)
        assert revoked.items == []
        search.get_documents_by_urns.assert_not_awaited()
    finally:
        await session.execute(delete(Bookmark).where(Bookmark.organization_id == threads.org_id))
        await session.commit()
