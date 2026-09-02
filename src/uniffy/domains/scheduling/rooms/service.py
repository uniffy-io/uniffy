from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.rooms.rpc.bookings import BookingHandlers
from uniffy.domains.scheduling.rooms.rpc.rooms import RoomHandlers


class RoomsServiceImpl(RoomHandlers, BookingHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer
