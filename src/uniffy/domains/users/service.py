from uniffy.core.storage import ObjectStorage
from uniffy.domains.users.handlers import UsersHandlers


class UsersServiceImpl(UsersHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
