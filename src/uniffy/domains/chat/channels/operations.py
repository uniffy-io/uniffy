"""Public chat channel operations façade."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.channels.agents import AgentChannels
from uniffy.domains.chat.channels.creation import ChannelCreation
from uniffy.domains.chat.channels.direct import DirectChannels
from uniffy.domains.chat.channels.events import ChannelEvents
from uniffy.domains.chat.channels.lifecycle import ChannelLifecycle
from uniffy.domains.chat.channels.members import ChannelMembers
from uniffy.domains.chat.channels.projection import ChannelProjection
from uniffy.domains.chat.channels.queries import ChannelQueries
from uniffy.domains.chat.channels.subjects import ChannelSubjects
from uniffy.domains.chat.channels.updates import ChannelUpdates
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle


class ChatChannelOperations(
    ChannelProjection,
    ChannelCreation,
    DirectChannels,
    AgentChannels,
    ChannelQueries,
    ChannelUpdates,
    ChannelLifecycle,
    ChannelMembers,
    ChannelEvents,
    ChannelSubjects,
    BaseContentOperations[ChatChannel],
):
    """Stable aggregate API over focused channel use cases."""

    content_type = ContentType.CHAT
    model_class = ChatChannel

    def __init__(
        self,
        session: AsyncSession,
        access: ChatAccessChecker | None = None,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
        call_lifecycle: ChannelCallLifecycle | None = None,
    ) -> None:
        super().__init__(session, search_indexer)
        self.access = access or ChatAccessChecker(session)
        self.storage = storage
        self._call_lifecycle = call_lifecycle

    @property
    def call_lifecycle(self) -> ChannelCallLifecycle:
        if self._call_lifecycle is None:
            raise RuntimeError("Call lifecycle is required for destructive channel operations")
        return self._call_lifecycle
