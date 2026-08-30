from uniffy.domains.rooms.handlers import BookingHandlers, RoomHandlers


class RoomsServiceImpl(RoomHandlers, BookingHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
