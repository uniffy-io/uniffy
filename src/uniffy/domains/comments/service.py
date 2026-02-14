"""Comments service wrapper for ConnectRPC mounting."""

from uniffy.domains.comments.handlers import CommentsHandlers


class CommentsServiceImpl(CommentsHandlers):
    """
    Combined comments service implementation.

    Inherits from CommentsHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
