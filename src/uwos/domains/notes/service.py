"""Notes service wrapper for ConnectRPC mounting."""

from uwos.domains.notes.handlers import NotesHandlers


class NotesServiceImpl(NotesHandlers):
    """
    Combined notes service implementation.

    Inherits from NotesHandlers to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
