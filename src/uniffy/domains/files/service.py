"""Files service wrapper for ConnectRPC mounting."""

from uniffy.core.storage import ObjectStorage
from uniffy.domains.files.attachments.handlers import AttachmentsHandlersMixin
from uniffy.domains.files.filters import SavedFilterHandlersMixin
from uniffy.domains.files.handlers import FilesHandlers
from uniffy.domains.files.quota.handlers import QuotaHandlersMixin


class FilesServiceImpl(
    FilesHandlers,
    QuotaHandlersMixin,
    SavedFilterHandlersMixin,
    AttachmentsHandlersMixin,
):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
