"""Calendar service wrapper for ConnectRPC mounting."""

from uniffy.domains.calendar.handlers import CalendarHandlers
from uniffy.domains.calendar.rpc.scheduling import SchedulingHandlers


class CalendarServiceImpl(CalendarHandlers, SchedulingHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
