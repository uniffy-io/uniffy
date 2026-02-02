"""Files service wrapper for ConnectRPC mounting."""

from uniffy.domains.files.filters import SavedFilterHandlersMixin
from uniffy.domains.files.handlers import FilesHandlers


class FilesServiceImpl(FilesHandlers, SavedFilterHandlersMixin):
    """
    Combined files service implementation.

    Inherits from FilesHandlers and SavedFilterHandlersMixin to provide
    a single service that can be mounted on ConnectRPC.
    """

    pass
