"""Calendar service wrapper for ConnectRPC mounting."""

from uniffy.core.search import SearchIndexer
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle
from uniffy.domains.scheduling.calendar.handlers import CalendarHandlers
from uniffy.domains.scheduling.calendar.rpc.scheduling import SchedulingHandlers


class CalendarServiceImpl(CalendarHandlers, SchedulingHandlers):
    def __init__(
        self,
        search_indexer: SearchIndexer,
        call_lifecycle: ChannelCallLifecycle,
    ) -> None:
        self.search_indexer = search_indexer
        self.call_lifecycle = call_lifecycle
