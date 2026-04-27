"""Files service wrapper for ConnectRPC mounting."""

from uniffy.domains.files.filters import SavedFilterHandlersMixin
from uniffy.domains.files.handlers import FilesHandlers
from uniffy.domains.files.quota_handlers import QuotaHandlersMixin


class FilesServiceImpl(FilesHandlers, QuotaHandlersMixin, SavedFilterHandlersMixin):
    """
    Combined files service implementation.

    Inherits from FilesHandlers, QuotaHandlersMixin, and
    SavedFilterHandlersMixin to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
