"""Files service wrapper for ConnectRPC mounting."""

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
    pass
